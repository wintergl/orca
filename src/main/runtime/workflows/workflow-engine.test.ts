import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_WORKFLOW_TEMPLATES } from '../../../shared/workflow-fixtures'
import { OrchestrationDb } from '../orchestration/db'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WorkflowEngine } from './workflow-engine'
import {
  queueCompletion,
  queueDecisionCompletion
} from './workflow-engine-test-completion-fixtures'
import {
  cleanupWorkflowEngineHarnesses,
  lifecycleIdForHandle,
  paneKeyForHandle,
  providerSessionIdForHandle,
  registerWorkflowEngine,
  registerWorkflowEngineCleanupPath,
  registerWorkflowEngineOrchestration,
  registerWorkflowEngineStore,
  WORKFLOW_ENGINE_TEST_HANDLES
} from './workflow-engine-test-harness-support'
import {
  assigned,
  match,
  mutation,
  readyCombinedRun,
  readyRun
} from './workflow-engine-test-run-fixtures'
import { waitForRun, waitForStepStatus } from './workflow-engine-test-waits'
import { WorkflowStore } from './workflow-store'

afterEach(async () => {
  await cleanupWorkflowEngineHarnesses()
})

describe('WorkflowEngine M2', () => {
  it('starts a ready Run idempotently with one Task, Dispatch, and prompt', async () => {
    const harness = await createHarness()
    const runId = readyRun(harness.store, harness.runtime)
    const mutationReceipt = mutation('start-once', { runId })

    const first = await harness.engine.start(runId, 'user-a', mutationReceipt)
    const second = await harness.engine.start(runId, 'user-a', mutationReceipt)

    expect(first.status).toBe('running')
    expect(second.status).toBe('running')
    expect(harness.orchestration.listTasks()).toHaveLength(1)
    expect(harness.sendPrompt).toHaveBeenCalledTimes(1)
    const prompt = harness.sendPrompt.mock.calls[0]?.[1] ?? ''
    expect(prompt).toContain('Change and review src/result.ts.')
    expect(prompt).toContain('完成后直接返回完整结果。')
    expect(prompt).not.toContain('后台采集')
    expect(prompt).not.toContain('推进工作流')
    expect(prompt).not.toContain('UTF-8 JSON')
    expect(prompt).not.toContain('workflow.completion/v1')
    expect(prompt).not.toContain('You are working inside Orca')
    expect(prompt).not.toContain('orchestration send')
    expect(prompt).not.toContain('heartbeat')
    expect(prompt).not.toContain('"taskId"')
    expect(prompt.split('Change and review src/result.ts.')).toHaveLength(2)
    expect(harness.store.showRun(runId, 'user-a').steps[0]).toMatchObject({
      status: 'delivering',
      deliveryState: 'delivered',
      taskId: expect.any(String),
      dispatchId: expect.any(String)
    })
    await harness.reportStatus('terminal-producer', 'working')
    expect(harness.store.showRun(runId, 'user-a').steps[0]?.status).toBe('running')
  })

  it('uses the bound Agent Hook for both start and final-result progression', async () => {
    const harness = await createHarness()
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('hook-lifecycle', { runId }))
    await harness.reportStatus('terminal-producer', 'working')
    await writeFile(join(harness.workspacePath, 'src', 'result.ts'), 'export const value = 2\n')
    await harness.reportStatus('terminal-producer', 'done', 'SPEC 已完成并通过检查。')
    const progressed = await waitForStepStatus(harness.store, runId, 'produce', 'succeeded')

    expect(progressed.steps[0]).toMatchObject({
      status: 'succeeded',
      conclusionMarkdown: 'SPEC 已完成并通过检查。'
    })
    expect(
      harness.store.runEvents(runId).events.filter((event) => event.type === 'step-working')
    ).toHaveLength(1)
  })

  it('does not let a same-pane stale lifecycle advance the Workflow', async () => {
    const harness = await createHarness()
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('hook-stale-lifecycle', { runId }))

    await expect(
      harness.reportStatus('terminal-producer', 'working', undefined, 'stale-lifecycle')
    ).resolves.toBe(false)
    expect(harness.store.showRun(runId, 'user-a').steps[0]?.status).toBe('delivering')
  })

  it('advances Produce to Review and completes only from bound structured reports', async () => {
    const harness = await createHarness({ autoComplete: true })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('start-complete', { runId }))
    const completed = await waitForRun(harness.store, runId, 'completed')

    expect(completed.steps.map((step) => [step.nodeType, step.status])).toEqual([
      ['produce', 'succeeded'],
      ['review', 'succeeded'],
      ['decide', 'succeeded'],
      ['complete', 'succeeded']
    ])
    expect(completed.reviewAggregates).toHaveLength(1)
    expect(completed.reviewAggregates[0]).toMatchObject({
      outcome: 'approve',
      waitingReason: null
    })
    expect(completed.artifacts).toHaveLength(1)
    expect(completed.artifacts[0]).toMatchObject({
      kind: 'code',
      snapshotState: 'frozen'
    })
    const artifact = completed.artifacts[0]!
    registerWorkflowEngineCleanupPath(artifact.materializedPath!)
    const resultEntry = artifact.manifest.entries.find((entry) => entry.path === 'src/result.ts')!
    const frozen = await readFile(
      join(artifact.materializedPath!, 'blobs', resultEntry.digest),
      'utf8'
    )
    await writeFile(join(harness.workspacePath, 'src', 'result.ts'), 'export const value = 3\n')
    expect(frozen).toBe('export const value = 2\n')
    expect(
      await readFile(join(artifact.materializedPath!, 'blobs', resultEntry.digest), 'utf8')
    ).toBe(frozen)
    expect(harness.orchestration.listTasks()).toHaveLength(2)
    expect(harness.sendPrompt).toHaveBeenCalledTimes(2)
    expect(harness.store.runEvents(runId).events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run-started', 'prompt-delivered', 'step-completed', 'run-completed'])
    )
  })

  it('fails completion-incomplete when Produce omits the bound complete envelope', async () => {
    const harness = await createHarness({ autoComplete: true, invalidProduce: true })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('start-complete', { runId }))
    const failed = await waitForRun(harness.store, runId, 'waiting-human')

    expect(failed.failureCode).toBe('workflow_completion_incomplete')
    expect(failed.steps[0]?.status).toBe('completion-incomplete')
    expect(harness.orchestration.listTasks()).toHaveLength(1)
  })

  it('rejects a reportPath that is a symbolic link', async () => {
    const harness = await createHarness({ autoComplete: true, symlinkReport: true })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('start-symlink', { runId }))
    const failed = await waitForRun(harness.store, runId, 'waiting-human')

    expect(failed.failureCode).toBe('workflow_completion_incomplete')
    expect(failed.steps[0]?.status).toBe('completion-incomplete')
  })

  it('classifies a missing reportPath as completion-incomplete', async () => {
    const harness = await createHarness({ autoComplete: true, omitReport: true })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('start-missing-report', { runId }))
    const failed = await waitForRun(harness.store, runId, 'waiting-human')

    expect(failed.failureCode).toBe('workflow_completion_incomplete')
    expect(failed.steps[0]?.status).toBe('completion-incomplete')
  })

  it('stops Review and marks the frozen Artifact drifted when the workspace changes', async () => {
    const harness = await createHarness({ autoComplete: true, mutateDuringReview: true })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('start-complete', { runId }))
    const failed = await waitForRun(harness.store, runId, 'waiting-human')

    expect(failed.waitingReason).toBe('reviewer-retry-exhausted')
    expect(failed.artifacts[0]?.snapshotState).toBe('drifted')
    registerWorkflowEngineCleanupPath(failed.artifacts[0]!.materializedPath!)
  })

  it('rejects a changed Provider Session before sending any prompt', async () => {
    const harness = await createHarness()
    const runId = readyRun(harness.store, harness.runtime)
    harness.setProducerSessionId('replacement-session')

    await expect(
      harness.engine.start(runId, 'user-a', mutation('start-complete', { runId }))
    ).rejects.toThrow('Provider Session')
    expect(harness.store.showRun(runId, 'user-a')).toMatchObject({
      status: 'waiting-human',
      waitingReason: 'agent-unavailable'
    })
    expect(harness.sendPrompt).not.toHaveBeenCalled()
  })

  it('fans out independent Reviewers and aggregates out-of-order results once', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewerCount: 2,
      reviewDelays: [40, 0],
      reviewVerdicts: ['approve', 'request-human']
    })
    const runId = readyRun(harness.store, harness.runtime, 2)

    await harness.engine.start(runId, 'user-a', mutation('start-parallel', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')

    const reviewSteps = waiting.steps.filter((step) => step.nodeType === 'review')
    expect(reviewSteps).toHaveLength(2)
    expect(new Set(reviewSteps.map((step) => step.taskId)).size).toBe(2)
    expect(new Set(reviewSteps.map((step) => step.dispatchId)).size).toBe(2)
    expect(new Set(reviewSteps.map((step) => step.deliveryId)).size).toBe(2)
    expect(new Set(reviewSteps.map((step) => step.inputArtifactRevisionId)).size).toBe(1)
    const reviewPrompts = harness.sendPrompt.mock.calls
      .filter(([handle]) => handle !== 'terminal-producer')
      .map(([, prompt]) => prompt)
    expect(new Set(reviewPrompts.map((prompt) => match(prompt, /^Digest: ([^\n]+)/m))).size).toBe(1)
    expect(reviewPrompts.every((prompt) => prompt.includes('"blobId": "sha256:'))).toBe(true)
    expect(reviewPrompts.every((prompt) => prompt.includes('当前工作目标为：'))).toBe(true)
    expect(reviewPrompts.every((prompt) => !prompt.includes('{{'))).toBe(true)
    expect(waiting.reviewAggregates).toHaveLength(1)
    expect(waiting.reviewAggregates[0]).toMatchObject({
      outcome: 'request-human',
      waitingReason: 'review-conflict'
    })
    expect(waiting.resolutionContext).toMatchObject({
      reviewNodeId: 'code-review',
      artifactRevisionId: waiting.artifacts[0]?.id
    })
    expect(harness.orchestration.listTasks()).toHaveLength(3)
  })

  it('retries one Reviewer without redispatching another Reviewer', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewerCount: 2,
      failFirstReviewerDelivery: true
    })
    const runId = readyRun(harness.store, harness.runtime, 2)

    await harness.engine.start(runId, 'user-a', mutation('start-retry', { runId }))
    const completed = await waitForRun(harness.store, runId, 'completed')

    const reviewerOneCalls = harness.sendPrompt.mock.calls.filter(
      ([handle]) => handle === 'terminal-reviewer'
    )
    const reviewerTwoCalls = harness.sendPrompt.mock.calls.filter(
      ([handle]) => handle === 'terminal-reviewer-2'
    )
    expect(reviewerOneCalls).toHaveLength(2)
    expect(reviewerTwoCalls).toHaveLength(1)
    expect(
      completed.steps.filter(
        (step) => step.nodeType === 'review' && step.assignment?.agentLifecycleId === 'reviewer'
      )
    ).toHaveLength(2)
    expect(completed.reviewAggregates).toHaveLength(1)
  })

  it('times out one Reviewer without discarding another Reviewer result', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewerCount: 2,
      omitReviewerCompletionIndex: 0
    })
    const definition = structuredClone(
      BUILTIN_WORKFLOW_TEMPLATES.find((fixture) => fixture.id === 'builtin.code-review.v1')!
        .definition
    )
    const reviewNode = definition.nodes.find((node) => node.type === 'review')!
    if (reviewNode.type === 'review') {
      reviewNode.reviewPolicy.timeoutMs = 1_000
      reviewNode.retryPolicy.maxAttempts = 1
    }
    const template = harness.store.createTemplate(
      { name: 'Timeout review', scope: 'personal', definition },
      mutation('create-timeout-template', {})
    )
    const runId = readyRun(harness.store, harness.runtime, 2, template.id)

    await harness.engine.start(runId, 'user-a', mutation('start-timeout', { runId }))
    await waitForRun(harness.store, runId, 'waiting-human')
    await waitForStepStatus(harness.store, runId, 'review', 'succeeded')
    const waiting = harness.store.showRun(runId, 'user-a')

    const reviewers = waiting.steps.filter((step) => step.nodeType === 'review')
    expect(reviewers.find((step) => step.assignment?.agentLifecycleId === 'reviewer')?.status).toBe(
      'timed-out'
    )
    expect(
      reviewers.find((step) => step.assignment?.agentLifecycleId === 'reviewer-2')?.status
    ).toBe('succeeded')
    expect(waiting.waitingReason).toBe('reviewer-retry-exhausted')
    expect(harness.store.runEvents(runId).events.map((event) => event.type)).toContain(
      'reviewer-timed-out'
    )
  })
})

describe('WorkflowEngine M4', () => {
  it('creates immutable revision rounds and stops without a fourth revision task', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdicts: ['revise']
    })
    const runId = readyRun(harness.store, harness.runtime)

    await harness.engine.start(runId, 'user-a', mutation('m4-review-limit', { runId }))
    const limited = await waitForRun(harness.store, runId, 'review-limit-reached')

    expect(limited.steps.filter((step) => step.nodeType === 'produce')).toHaveLength(3)
    expect(limited.steps.filter((step) => step.nodeType === 'review')).toHaveLength(3)
    expect(limited.artifacts.map((artifact) => artifact.revision)).toEqual([1, 2, 3])
    expect(limited.reviewRoundsByNodeId).toEqual({ 'code-review': 3 })
    expect(limited.resolutionOffers.map((offer) => offer.action)).toEqual([
      'view-evidence',
      'revise',
      'continue-round',
      'approve',
      'end-workflow'
    ])
    expect(harness.orchestration.listTasks()).toHaveLength(6)
  })

  it('extends only the current Review node by one round from an Engine Offer', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdicts: ['revise']
    })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-limit-continue', { runId }))
    const limited = await waitForRun(harness.store, runId, 'review-limit-reached')
    const offer = limited.resolutionOffers.find(
      (candidate) => candidate.action === 'continue-round'
    )!

    const resumed = harness.store.resolveRun(
      {
        runId,
        offerId: offer.id,
        reason: 'One more bounded revision is justified.',
        confirmation: true
      },
      mutation('m4-continue-round', { offerId: offer.id })
    )
    await harness.engine.resume(resumed.id, 'user-a')
    const limitedAgain = await waitForRun(harness.store, runId, 'review-limit-reached')

    expect(limitedAgain.reviewRoundExtensionsByNodeId).toEqual({ 'code-review': 1 })
    expect(limitedAgain.reviewRoundsByNodeId).toEqual({ 'code-review': 4 })
    expect(limitedAgain.artifacts).toHaveLength(4)
    expect(limitedAgain.steps.filter((step) => step.nodeType === 'produce')).toHaveLength(4)
  }, 15_000)

  it('persists an in-flight completion while paused and advances once on Resume', async () => {
    const harness = await createHarness({ autoComplete: true })
    const runId = readyRun(harness.store, harness.runtime)
    const started = await harness.engine.start(
      runId,
      'user-a',
      mutation('m4-pause-start', { runId })
    )
    const paused = harness.store.pauseRun(
      { runId, expectedVersion: started.version },
      mutation('m4-pause', { runId })
    )

    expect(paused.status).toBe('paused')
    const completedProduce = await waitForStepStatus(harness.store, runId, 'produce', 'succeeded')
    expect(completedProduce.steps.filter((step) => step.nodeType === 'review')).toHaveLength(0)

    const resumed = harness.store.resumeRun(
      { runId, expectedVersion: completedProduce.version },
      mutation('m4-resume', { runId })
    )
    await harness.engine.resume(resumed.id, 'user-a')
    const completed = await waitForRun(harness.store, runId, 'completed')
    expect(completed.steps.filter((step) => step.nodeType === 'produce')).toHaveLength(1)
    expect(completed.steps.filter((step) => step.nodeType === 'review')).toHaveLength(1)
  })

  it('retries a failed Step with a new attempt without increasing Review round', async () => {
    const harness = await createHarness({ autoComplete: true, invalidProduce: true })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-retry-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const failedStep = waiting.steps[0]!

    const retried = harness.store.retryStep(
      {
        runId,
        stepRunId: failedStep.id,
        expectedVersion: waiting.version,
        reason: 'Provide the complete bound envelope.'
      },
      mutation('m4-retry-step', { stepRunId: failedStep.id })
    )

    expect(retried.steps.toReversed()[0]).toMatchObject({ attempt: 2, round: 1, status: 'queued' })
    expect(retried.reviewRoundsByNodeId).toEqual({})
    expect(waiting.resolutionOffers.map((offer) => offer.action)).not.toContain('approve')
  })

  it('accepts only the current Offer and audits a manual Review approval', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdicts: ['request-human']
    })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-human-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const approve = waiting.resolutionOffers.find((offer) => offer.action === 'approve')!

    await expect(
      Promise.resolve().then(() =>
        harness.store.resolveRun(
          {
            runId,
            offerId: 'workflow_offer_forged',
            reason: 'Forged',
            confirmation: true
          },
          mutation('m4-forged-offer', {})
        )
      )
    ).rejects.toMatchObject({ code: 'workflow_offer_conflict' })

    const approved = harness.store.resolveRun(
      {
        runId,
        offerId: approve.id,
        reason: 'Reviewed the conflict evidence and accept this revision.',
        confirmation: true
      },
      mutation('m4-human-approve', { offerId: approve.id })
    )
    expect(approved.status).toBe('completed')
    expect(approved.decisions.toReversed()[0]).toMatchObject({
      source: 'human',
      finalDecision: 'approve'
    })
    expect(harness.store.runEvents(runId).events.map((event) => event.type)).toContain(
      'human-action'
    )
    await expect(
      Promise.resolve().then(() =>
        harness.store.resolveRun(
          { runId, offerId: approve.id, confirmation: true, reason: 'Stale' },
          mutation('m4-stale-offer', {})
        )
      )
    ).rejects.toMatchObject({ code: 'workflow_offer_conflict' })
  })

  it('starts a new consumable Review budget with human instructions after manual revision', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdictSequence: ['request-human', 'revise', 'revise']
    })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-human-budget-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const revise = waiting.resolutionOffers.find((offer) => offer.action === 'revise')!

    const revised = harness.store.resolveRun(
      {
        runId,
        offerId: revise.id,
        reason: 'Keep the API stable and add the missing boundary test.',
        reviewRoundBudget: 2,
        confirmation: true
      },
      mutation('m4-human-budget-revise', { offerId: revise.id })
    )
    await harness.engine.resume(revised.id, 'user-a')
    const limited = await waitForRun(harness.store, runId, 'review-limit-reached')

    expect(limited.steps.filter((step) => step.nodeType === 'review')).toHaveLength(3)
    expect(limited.reviewRoundsByNodeId).toEqual({ 'code-review': 3 })
    expect(limited.decisions.find((decision) => decision.source === 'human')?.input).toMatchObject({
      humanInstructions: 'Keep the API stable and add the missing boundary test.',
      reviewRoundBudget: 2
    })
    const revisionPrompts = harness.sendPrompt.mock.calls
      .filter(([handle]) => handle === 'terminal-producer')
      .map(([, prompt]) => prompt)
    expect(revisionPrompts.at(-1)).toContain(
      'Keep the API stable and add the missing boundary test.'
    )
  })

  it('ends a human-gated Review in an audited cancelled terminal state', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdicts: ['request-human']
    })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-end-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const end = waiting.resolutionOffers.find((offer) => offer.action === 'end-workflow')!

    const cancelled = harness.store.resolveRun(
      {
        runId,
        offerId: end.id,
        reason: 'End with the final Review evidence preserved.',
        confirmation: true
      },
      mutation('m4-end-workflow', { offerId: end.id })
    )

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      failureCode: 'ended-at-review'
    })
  })

  it('cancels without deleting the workspace or rolling back files', async () => {
    const harness = await createHarness()
    const runId = readyRun(harness.store, harness.runtime)
    const started = await harness.engine.start(
      runId,
      'user-a',
      mutation('m4-cancel-start', { runId })
    )

    const cancelled = harness.store.cancelRun(
      {
        runId,
        expectedVersion: started.version,
        reason: 'Stop this bounded test Run.',
        confirmation: true,
        runningAgentAction: 'preserve-running'
      },
      mutation('m4-cancel', { runId })
    )

    expect(cancelled.status).toBe('cancelled')
    expect(await readFile(join(harness.workspacePath, 'src', 'result.ts'), 'utf8')).toBe(
      'export const value = 1\n'
    )
    expect(harness.store.runEvents(runId).events.map((event) => event.type)).toContain(
      'run-cancelled'
    )
  })

  it('moves a combined SPEC approval into code production and completes only after code approval', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdictSequence: ['request-human', 'request-human']
    })
    const runId = readyCombinedRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-combined-start', { runId }))
    const specWaiting = await waitForRun(harness.store, runId, 'waiting-human')
    const specApprove = specWaiting.resolutionOffers.find((offer) => offer.action === 'approve')!

    const codeRunning = harness.store.resolveRun(
      {
        runId,
        offerId: specApprove.id,
        reason: 'SPEC evidence is accepted.',
        confirmation: true
      },
      mutation('m4-spec-approve', { offerId: specApprove.id })
    )
    expect(codeRunning).toMatchObject({ status: 'running', currentNodeId: 'code-produce' })
    await harness.engine.resume(runId, 'user-a')
    const codeWaiting = await waitForRun(harness.store, runId, 'waiting-human')
    expect(codeWaiting.currentNodeId).toBe('code-decide')
    expect(codeWaiting.status).not.toBe('completed')

    const codeApprove = codeWaiting.resolutionOffers.find((offer) => offer.action === 'approve')!
    const completed = harness.store.resolveRun(
      {
        runId,
        offerId: codeApprove.id,
        reason: 'Code Review evidence is accepted.',
        confirmation: true
      },
      mutation('m4-code-approve', { offerId: codeApprove.id })
    )

    expect(completed.status).toBe('completed')
    expect(completed.artifacts.map((artifact) => artifact.kind)).toEqual(['spec', 'code'])
    expect(completed.reviewRoundsByNodeId).toEqual({ 'spec-review': 1, 'code-review': 1 })
    expect(completed.decisions.filter((decision) => decision.source === 'human')).toHaveLength(2)
  })

  it('never dispatches a reassigned Step to a stale lifecycle on the same Pane', async () => {
    const harness = await createHarness({ autoComplete: true, invalidProduce: true })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-reassign-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const failedStep = waiting.steps[0]!
    const reassigned = harness.store.reassignStep(
      {
        runId,
        stepRunId: failedStep.id,
        expectedVersion: waiting.version,
        assignment: assigned('pane-producer', 'replacement-producer', 'replacement-session'),
        reason: 'Replace the unavailable lifecycle.'
      },
      mutation('m4-reassign', { stepRunId: failedStep.id })
    )

    await expect(harness.engine.resume(reassigned.id, 'user-a')).rejects.toThrow(
      'authority changed'
    )
    expect(harness.sendPrompt).toHaveBeenCalledTimes(1)
    expect(harness.store.showRun(runId, 'user-a')).toMatchObject({
      status: 'waiting-human',
      waitingReason: 'agent-unavailable'
    })
  })

  it('allows only one concurrent human decision to advance a Run', async () => {
    const harness = await createHarness({
      autoComplete: true,
      reviewVerdicts: ['request-human']
    })
    const runId = readyRun(harness.store, harness.runtime)
    await harness.engine.start(runId, 'user-a', mutation('m4-concurrent-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const approve = waiting.resolutionOffers.find((offer) => offer.action === 'approve')!

    const outcomes = await Promise.allSettled(
      ['first', 'second'].map((suffix) =>
        Promise.resolve().then(() =>
          harness.store.resolveRun(
            {
              runId,
              offerId: approve.id,
              reason: `Concurrent approval ${suffix}.`,
              confirmation: true
            },
            mutation(`m4-concurrent-${suffix}`, { offerId: approve.id })
          )
        )
      )
    )

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(harness.store.showRun(runId, 'user-a').status).toBe('completed')
  })

  it('retries invalid Decision Agent output and then waits without guessing a decision', async () => {
    const harness = await createHarness({ autoComplete: true, invalidDecisionAgent: true })
    const runId = readyRun(harness.store, harness.runtime, 1, 'builtin.code-review.v1', true)
    await harness.engine.start(runId, 'user-a', mutation('m4-decision-agent-start', { runId }))
    const waiting = await waitForRun(harness.store, runId, 'waiting-human')
    const decisionSteps = waiting.steps.filter((step) => step.nodeType === 'decide')

    expect(decisionSteps.map((step) => [step.attempt, step.status])).toEqual([
      [1, 'failed'],
      [2, 'failed']
    ])
    expect(waiting).toMatchObject({
      waitingReason: 'decision-invalid',
      decisions: []
    })
    expect(
      harness.sendPrompt.mock.calls.filter(([handle]) => handle === 'terminal-decider')
    ).toHaveLength(2)
  })
})

async function createHarness(
  options: {
    autoComplete?: boolean
    invalidProduce?: boolean
    mutateDuringReview?: boolean
    omitReport?: boolean
    symlinkReport?: boolean
    reviewerCount?: number
    reviewDelays?: number[]
    reviewVerdicts?: ('approve' | 'revise' | 'request-human')[]
    reviewVerdictSequence?: ('approve' | 'revise' | 'request-human')[]
    failFirstReviewerDelivery?: boolean
    omitReviewerCompletionIndex?: number
    invalidDecisionAgent?: boolean
  } = {}
) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-engine-'))
  registerWorkflowEngineCleanupPath(workspacePath)
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await writeFile(join(workspacePath, 'src', 'result.ts'), 'export const value = 1\n')
  const store = new WorkflowStore(':memory:')
  const orchestration = new OrchestrationDb(':memory:')
  registerWorkflowEngineStore(store)
  registerWorkflowEngineOrchestration(orchestration)
  let runtime!: OrcaRuntimeService
  let engine!: WorkflowEngine
  let producerSessionId = 'session-producer'
  let firstReviewerDeliveryFailed = false
  let reviewCompletionIndex = 0
  const sendPrompt = vi.fn(async (handle: string, prompt: string) => {
    if (
      options.failFirstReviewerDelivery &&
      handle === 'terminal-reviewer' &&
      !firstReviewerDeliveryFailed
    ) {
      firstReviewerDeliveryFailed = true
      throw new Error('reviewer transport failed before acceptance')
    }
    if (!options.autoComplete) {
      return { handle, accepted: true, bytesWritten: prompt.length }
    }
    setTimeout(() => void reportStatus(handle, 'working'), 0)
    if (handle === 'terminal-producer' || handle === 'terminal-spec-producer') {
      await writeFile(join(workspacePath, 'src', 'result.ts'), 'export const value = 2\n')
      queueCompletion(
        runtime,
        orchestration,
        handle,
        handle === 'terminal-producer' ? 'pane-producer' : 'pane-spec-producer',
        'produce',
        options.invalidProduce,
        options.symlinkReport,
        options.omitReport
      )
    } else if (handle === 'terminal-decider') {
      queueDecisionCompletion(orchestration, handle, options.invalidDecisionAgent ?? false)
    } else {
      if (options.mutateDuringReview) {
        await writeFile(join(workspacePath, 'src', 'result.ts'), 'export const value = 9\n')
      }
      const reviewerIndex = handle === 'terminal-reviewer-2' ? 1 : 0
      if (options.omitReviewerCompletionIndex === reviewerIndex) {
        return { handle, accepted: true, bytesWritten: prompt.length }
      }
      queueCompletion(
        runtime,
        orchestration,
        handle,
        handle === 'terminal-spec-reviewer'
          ? 'pane-spec-reviewer'
          : reviewerIndex === 1
            ? 'pane-reviewer-2'
            : 'pane-reviewer',
        'review',
        false,
        false,
        false,
        options.reviewDelays?.[reviewerIndex] ?? 0,
        options.reviewVerdictSequence?.[reviewCompletionIndex++] ??
          options.reviewVerdicts?.[reviewerIndex] ??
          'approve'
      )
    }
    return { handle, accepted: true, bytesWritten: prompt.length }
  })
  runtime = {
    getRuntimeId: () => 'runtime-test',
    getOrchestrationDb: () => orchestration,
    resolveTerminalPane: (paneKey: string, worktreeId?: string) => ({
      handle: WORKFLOW_ENGINE_TEST_HANDLES[paneKey]!,
      tabId: 'tab',
      leafId: paneKey,
      ptyId: `pty-${paneKey}`,
      worktreeId
    }),
    getTerminalAgentStatus: async (handle: string) => ({
      handle,
      isRunningAgent: true,
      status: 'idle'
    }),
    getTerminalProcessIncarnation: (handle: string) => `process-${handle}`,
    getExactWorkerProviderSession: (handle: string) => ({
      paneKey: paneKeyForHandle(handle),
      processIncarnation: `process-${handle}`,
      agent: 'codex',
      providerSession: {
        key: 'session_id',
        id: providerSessionIdForHandle(handle, producerSessionId)
      },
      observedAt: Date.now()
    }),
    getTerminalOrchestrationCliCommand: () => 'orca',
    getTerminalPaneKey: paneKeyForHandle,
    showTerminal: async (handle: string) => ({
      handle,
      connected: true,
      writable: true,
      worktreeId: 'folder-a'
    }),
    showManagedWorktree: async () => ({
      git: { path: workspacePath }
    }),
    sendTerminalAgentPrompt: sendPrompt
  } as unknown as OrcaRuntimeService
  engine = new WorkflowEngine(runtime, store, orchestration)
  registerWorkflowEngine(engine)
  const reportStatus = async (
    handle: string,
    state: 'working' | 'done',
    lastAssistantMessage?: string,
    agentLifecycleId = lifecycleIdForHandle(handle)
  ): Promise<boolean> => {
    const dispatch = orchestration.getLatestDispatchForTerminal(handle)
    if (!dispatch) {
      throw new Error(`Workflow Dispatch for ${handle} is unavailable.`)
    }
    return engine.handleAgentStatus({
      state,
      paneKey: paneKeyForHandle(handle),
      worktreeId: 'folder-a',
      agentLifecycleId,
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      receivedAt: Date.now(),
      lastAssistantMessage
    })
  }
  return {
    store,
    orchestration,
    runtime,
    sendPrompt,
    engine,
    reportStatus,
    workspacePath,
    setProducerSessionId: (value: string) => {
      producerSessionId = value
    }
  }
}

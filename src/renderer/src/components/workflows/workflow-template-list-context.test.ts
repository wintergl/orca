import { describe, expect, it } from 'vitest'
import type { WorkflowRunRecord } from '../../../../shared/workflow-definition-types'
import { resolveWorkflowTemplateListContext } from './workflow-template-list-context'

describe('Workflow template list context', () => {
  it('uses the Draft host and project while configuring a drifted workspace', () => {
    const result = resolveWorkflowTemplateListContext({
      page: 'application',
      activeRun: { projectIdentity: 'draft-project' } as WorkflowRunRecord,
      runTarget: { kind: 'environment', environmentId: 'draft-host' },
      workspaceTarget: { kind: 'local' },
      workspaceProjectIdentity: 'current-project'
    })

    expect(result).toEqual({
      target: { kind: 'environment', environmentId: 'draft-host' },
      projectIdentity: 'draft-project'
    })
  })

  it('uses the current workspace context on the template page', () => {
    const result = resolveWorkflowTemplateListContext({
      page: 'templates',
      activeRun: { projectIdentity: 'draft-project' } as WorkflowRunRecord,
      runTarget: { kind: 'environment', environmentId: 'draft-host' },
      workspaceTarget: { kind: 'local' },
      workspaceProjectIdentity: 'current-project'
    })

    expect(result).toEqual({
      target: { kind: 'local' },
      projectIdentity: 'current-project'
    })
  })
})

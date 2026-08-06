import { afterEach, describe, expect, it } from 'vitest'
import { workflowEventTypeLabel } from '@/components/workflows/workflow-event-type-labels'
import {
  workflowRunStatusLabel,
  workflowStepStatusLabel,
  workflowWorkspaceKindLabel
} from '@/components/workflows/workflow-runtime-state-labels'
import { i18n, translate } from './i18n'
import zh from './locales/zh.json'

function collectNonChineseCopy(node: unknown, path: string[] = []): string[] {
  if (typeof node === 'string') {
    return /[\u3400-\u9fff]/u.test(node) ? [] : [`${path.join('.')}: ${node}`]
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return []
  }
  return Object.entries(node).flatMap(([key, value]) =>
    collectNonChineseCopy(value, [...path, key])
  )
}

describe('Workflow Simplified Chinese copy', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('does not leave pure English text in the Workflow catalog', () => {
    expect(collectNonChineseCopy(zh.workflows, ['workflows'])).toEqual([])
  })

  it('localizes shared actions used by Workflow surfaces', () => {
    expect(zh.common.cancel).toBe('取消')
  })

  it('loads the Chinese V2 editor and run copy through the renderer translator', async () => {
    await i18n.changeLanguage('zh')

    expect(translate('workflows.visual.removeStep', 'Remove step')).toBe('删除步骤')
    expect(translate('workflows.visual.kindDecision', 'Decision')).toBe('判定')
    expect(translate('workflows.application.runBudget', 'Run budget')).toBe('运行预算')
    expect(translate('workflows.history.search', 'Search runs')).toBe('搜索运行记录')
    expect(workflowRunStatusLabel('running')).toBe('运行中')
    expect(workflowStepStatusLabel('timed-out')).toBe('已超时')
    expect(workflowWorkspaceKindLabel('folder-workspace')).toBe('文件夹工作区')
    expect(workflowEventTypeLabel('prompt-delivered')).toBe('提示词已投递')
  })
})

import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export function getWorkflowV2ExperimentalSearchEntry(): SettingsSearchEntry {
  return {
    title: translate('workflows.settings.v2.title', 'Workflow V2'),
    description: translate(
      'workflows.settings.v2.description',
      'Enable generic graph workflows on this runtime host.'
    ),
    keywords: [
      ...translateSearchKeyword('workflows.settings.v2.keywordWorkflow', 'workflow'),
      ...translateSearchKeyword('workflows.settings.v2.keywordExperimental', 'experimental'),
      ...translateSearchKeyword('workflows.settings.v2.keywordGraph', 'graph'),
      ...translateSearchKeyword('workflows.settings.v2.keywordV2', 'v2')
    ]
  }
}

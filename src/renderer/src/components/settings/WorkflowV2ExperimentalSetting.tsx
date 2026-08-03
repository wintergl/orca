import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getExperimentalSearchEntry } from './experimental-search'

export function WorkflowV2ExperimentalSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const enabled = settings['workflows.v2.enabled'] === true
  return (
    <SearchableSetting
      title={translate('workflows.settings.v2.title', 'Workflow V2')}
      description={translate(
        'workflows.settings.v2.description',
        'Enable generic graph workflows on this runtime host.'
      )}
      keywords={getExperimentalSearchEntry().workflowV2.keywords}
      className="space-y-3 py-2"
      id="experimental-workflow-v2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{translate('workflows.settings.v2.title', 'Workflow V2')}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'workflows.settings.v2.copy',
              'Allows V2 templates to be created and run on this host. Keep it off when you only need stable V1 workflows and history.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate('workflows.settings.v2.toggle', 'Toggle Workflow V2')}
          onChange={() => updateSettings({ 'workflows.v2.enabled': !enabled })}
        />
      </div>
    </SearchableSetting>
  )
}

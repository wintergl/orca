import type { WorkflowDefinitionV2, WorkflowRouteV2 } from './workflow-definition-v2-types'

export type WorkflowRouteCatalogEntryV2 = {
  id: string
  sourceStepId: string
  sourceStepName: string
  label: string
  route: WorkflowRouteV2
}

export function workflowV2RouteCatalog(
  definition: WorkflowDefinitionV2
): WorkflowRouteCatalogEntryV2[] {
  return definition.steps.flatMap((step) => {
    if (step.kind === 'agent') {
      return [entry(step.id, step.name, 'Next', `agent:${step.id}:next`, step.next)]
    }
    if (step.kind === 'decision') {
      return [
        entry(step.id, step.name, 'Complete', `decision:${step.id}:true`, step.routes.whenTrue),
        entry(step.id, step.name, 'Incomplete', `decision:${step.id}:false`, step.routes.whenFalse),
        entry(step.id, step.name, 'Invalid', `decision:${step.id}:invalid`, step.routes.whenInvalid)
      ]
    }
    if (step.kind === 'human') {
      return step.routes.map((route) =>
        entry(step.id, step.name, route.label, `human:${step.id}:${route.id}`, route)
      )
    }
    return []
  })
}

function entry(
  sourceStepId: string,
  sourceStepName: string,
  label: string,
  id: string,
  route: WorkflowRouteV2
): WorkflowRouteCatalogEntryV2 {
  return { id, sourceStepId, sourceStepName, label, route }
}

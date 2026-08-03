import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Workflow history remains reachable without an active run', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())

  const historyButton = orcaPage.getByRole('button', { name: /Run history|运行历史/ })
  await expect(historyButton).toBeVisible()
  await historyButton.click()

  await expect(orcaPage.locator('[data-workflow-run-history="true"]')).toBeVisible()
})

test('Workflow template choices separate V1 and V2', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())

  await orcaPage.getByRole('combobox', { name: /Choose workflow|选择工作流/ }).click()

  await expect(orcaPage.locator('[data-workflow-template-group="v1"]')).toBeVisible()
  await expect(orcaPage.locator('[data-workflow-template-group="v2"]')).toBeVisible()
})

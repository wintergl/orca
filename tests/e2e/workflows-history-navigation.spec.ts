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

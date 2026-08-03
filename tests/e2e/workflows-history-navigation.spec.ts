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

test('Idle built-in workflow can be edited and saved directly', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())

  await orcaPage.getByRole('combobox', { name: /Choose workflow|选择工作流/ }).click()
  await orcaPage.getByRole('option').first().click()
  await expect(orcaPage.locator('[data-workflow-template-editor="true"]')).toBeVisible()
  await orcaPage.getByRole('tab', { name: /Basic|基本/ }).click()
  const stepName = orcaPage.getByLabel(/Step name|步骤名称/).first()
  const editedName = `${await stepName.inputValue()} · edited`

  await stepName.fill(editedName)
  await orcaPage.getByRole('button', { name: /Save new version|保存新版本/ }).click()

  await expect(orcaPage.getByText(/Saved template v\d+|模板 v\d+ 已保存/)).toBeVisible()
  await expect(stepName).toHaveValue(editedName)
})

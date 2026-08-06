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

test('Workflow template choices expose V2 configurations only', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())

  await orcaPage.getByRole('combobox', { name: /Choose workflow|选择工作流/ }).click()

  await expect(orcaPage.locator('[data-workflow-template-group="v2"]')).toBeVisible()
  await expect(orcaPage.locator('[data-workflow-template-group="v1"]')).toHaveCount(0)
})

test('Default V2 workflow supports step ordering, End deletion, and saving', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())

  await orcaPage.getByRole('combobox', { name: /Choose workflow|选择工作流/ }).click()
  await orcaPage.getByRole('option').first().click()
  const editor = orcaPage.locator('[data-workflow-template-editor="v2"]')
  await expect(editor).toBeVisible()
  const stepName = orcaPage.getByLabel(/Step name|步骤名称/).first()
  const editedName = `${await stepName.inputValue()} · edited`

  await stepName.fill(editedName)
  const stepRows = editor.locator('aside li')
  const kindSelect = editor.locator('aside').getByRole('combobox')
  await kindSelect.click()
  await orcaPage.getByRole('option', { name: /Human/ }).click()
  await editor.getByRole('button', { name: /Add step|添加步骤/ }).click()
  await expect(stepRows).toHaveCount(3)
  await expect(stepRows.nth(1)).toContainText(/Human confirmation|人工确认/)
  await stepRows
    .nth(1)
    .getByRole('button', { name: /Move .* earlier|上移/ })
    .click()
  await expect(stepRows.nth(0)).toContainText(/Human confirmation|人工确认/)

  await kindSelect.click()
  await orcaPage.getByRole('option', { name: /^End$/ }).click()
  await editor.getByRole('button', { name: /Add step|添加步骤/ }).click()
  await expect(stepRows).toHaveCount(4)
  const addedEndRow = stepRows.nth(3)
  await expect(addedEndRow).toContainText(/End/)
  await addedEndRow.getByRole('button', { name: /Remove|删除/ }).click()
  await expect(stepRows).toHaveCount(3)

  await orcaPage.getByRole('button', { name: /Save new version|保存新版本/ }).click()

  await expect(orcaPage.getByText(/Saved template v\d+|模板 v\d+ 已保存/)).toBeVisible()
  await expect(stepName).toHaveValue(editedName)
})

import { expect, test } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer file replaces the Workflows surface with its editor preview', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await openFileExplorer(orcaPage)

  await orcaPage.evaluate(() => window.__store?.getState().openWorkflowsPage())
  await expect(orcaPage.locator('[data-workflow-tab-surface="true"]')).toBeVisible()

  const readmeRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.click()

  await expect(orcaPage.locator('[data-workflow-tab-surface="true"]')).toBeHidden()
  await expect(orcaPage.locator('.editor-header-path').first()).toContainText('README.md', {
    timeout: 25_000
  })
  await expect(
    orcaPage.getByRole('heading', { name: /Orca E2E Test Repo/i, level: 1 })
  ).toBeVisible({
    timeout: 25_000
  })
})

import type { Page } from '@stablyai/playwright-test'

export type TabRecoveryProbe = {
  atlasResets: number
  revealPresents: number
}

type TabRecoveryProbeWindow = Window & {
  __tabSwitchRecoveryProbe?: TabRecoveryProbe
}

export async function installTabRecoveryProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = { atlasResets: 0, revealPresents: 0 }
    ;(window as TabRecoveryProbeWindow).__tabSwitchRecoveryProbe = probe
    for (const manager of window.__paneManagers?.values() ?? []) {
      const originalReset = manager.resetWebglTextureAtlases?.bind(manager)
      if (originalReset) {
        manager.resetWebglTextureAtlases = () => {
          probe.atlasResets += 1
          originalReset()
        }
      }
      const originalPresent = manager.scheduleRevealPresent?.bind(manager)
      if (originalPresent) {
        manager.scheduleRevealPresent = () => {
          probe.revealPresents += 1
          originalPresent()
        }
      }
    }
  })
}

export async function readTabRecoveryProbe(page: Page): Promise<TabRecoveryProbe | null> {
  return page.evaluate(() => (window as TabRecoveryProbeWindow).__tabSwitchRecoveryProbe ?? null)
}

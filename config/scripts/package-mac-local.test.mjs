import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findMacAppBundleProcessIds,
  fingerprintInputs,
  isBuildFresh
} from './package-mac-local.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('package-mac-local cache', () => {
  it('changes the fingerprint when an input changes and ignores test files', () => {
    const root = temporaryRoot()
    mkdirSync(path.join(root, 'src'))
    writeFileSync(path.join(root, 'src', 'main.ts'), 'export const value = 1\n')
    const first = fingerprintInputs(root, ['src'])

    writeFileSync(path.join(root, 'src', 'main.test.ts'), 'ignored\n')
    expect(fingerprintInputs(root, ['src'])).toBe(first)
    writeFileSync(path.join(root, 'src', 'main.ts'), 'export const value = 2\n')
    expect(fingerprintInputs(root, ['src'])).not.toBe(first)
  })

  it('reuses a build only when its fingerprint and required outputs match', () => {
    const root = temporaryRoot()
    mkdirSync(path.join(root, 'out'))
    writeFileSync(path.join(root, 'out', 'main.js'), 'built\n')

    expect(isBuildFresh({ desktop: 'hash' }, 'desktop', 'hash', ['out/main.js'], root)).toBe(true)
    expect(isBuildFresh({ desktop: 'old' }, 'desktop', 'hash', ['out/main.js'], root)).toBe(false)
    expect(isBuildFresh({ desktop: 'hash' }, 'desktop', 'hash', ['out/missing.js'], root)).toBe(
      false
    )
  })
})

describe('package-mac-local running bundle guard', () => {
  it('finds processes executing from the bundle being replaced', () => {
    const appPath = path.join(path.sep, 'tmp', 'orca', 'dist', 'mac-arm64', 'Orca Dev.app')
    const mainExecutable = path.join(appPath, 'Contents', 'MacOS', 'Orca Dev')
    const helperExecutable = path.join(
      appPath,
      'Contents',
      'Frameworks',
      'Orca Dev Helper.app',
      'Contents',
      'MacOS',
      'Orca Dev Helper'
    )

    expect(
      findMacAppBundleProcessIds(
        appPath,
        ` 101 ${mainExecutable}\n102 ${helperExecutable} --type=renderer\n103 node package-mac-local.mjs\n`
      )
    ).toEqual([101, 102])
  })
})

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-package-mac-test-'))
  roots.push(root)
  return root
}

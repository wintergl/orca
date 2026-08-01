import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { getLocalBuildIdentity, localMacBuilderArgs } from './build-mac-local.mjs'
import { restartPackageWithNode24 } from './package-mac-node-runtime.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const scriptPath = import.meta.filename
const cachePath = path.join(repoRoot, 'out', '.package-mac-local-cache.json')
const ignoredNames = new Set(['.DS_Store', '.build', 'dist', 'node_modules'])

export function fingerprintInputs(root, entries) {
  const hash = createHash('sha256')
  for (const entry of entries.toSorted()) {
    hashPath(hash, root, path.resolve(root, entry))
  }
  return hash.digest('hex')
}

export function isBuildFresh(cache, key, fingerprint, requiredOutputs, root) {
  return (
    cache[key] === fingerprint &&
    requiredOutputs.every((output) => existsSync(path.resolve(root, output)))
  )
}

function hashPath(hash, root, absolutePath) {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
  if (!existsSync(absolutePath)) {
    hash.update(`missing:${relativePath}\0`)
    return
  }
  const stat = lstatSync(absolutePath)
  if (stat.isSymbolicLink()) {
    hash.update(`link:${relativePath}:${readlinkSync(absolutePath)}\0`)
    return
  }
  if (stat.isDirectory()) {
    hash.update(`directory:${relativePath}\0`)
    for (const name of readdirSync(absolutePath).toSorted()) {
      if (ignoredNames.has(name) || name.includes('.test.')) {
        continue
      }
      hashPath(hash, root, path.join(absolutePath, name))
    }
    return
  }
  if (stat.isFile()) {
    hash.update(`file:${relativePath}:${stat.mode & 0o777}\0`)
    hash.update(readFileSync(absolutePath))
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('package:mac is available only on macOS.')
  }
  if (process.argv.includes('--help')) {
    console.log('Usage: pnpm package:mac [--rebuild]')
    console.log('Builds one local .app for the current Mac architecture; --rebuild ignores caches.')
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    restartPackageWithNode24({
      scriptPath,
      args: process.argv.slice(2),
      cwd: repoRoot,
      environment: process.env
    })
    return
  }

  const startedAt = Date.now()
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const force = process.argv.includes('--rebuild')
  const cache = readCache()
  const nextCache = { ...cache }
  const localEnvironment = { ...process.env, ORCA_MAC_LOCAL_BUILD: '1' }

  buildCached({
    label: 'desktop',
    key: 'desktop',
    fingerprint: fingerprintInputs(repoRoot, [
      'build-plugins',
      'config/relay-assets',
      'config/scripts/build-relay.mjs',
      'config/scripts/install-dev-cli.mjs',
      'config/scripts/node-old-space-limit.mjs',
      'config/scripts/project-renderer-web-client.mjs',
      'config/scripts/run-electron-vite-build.mjs',
      'config/scripts/verify-cli-bin.mjs',
      'config/scripts/verify-web-build.mjs',
      'config/tsconfig.cli.json',
      'config/tsconfig.node.json',
      'config/tsconfig.relay.json',
      'config/tsconfig.web.json',
      'electron.vite.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'src',
      'tsconfig.json',
      'vite.web.config.ts'
    ]),
    outputs: [
      'out/cli/index.js',
      'out/main/index.js',
      'out/preload/index.js',
      'out/relay/darwin-arm64/relay.js',
      'out/renderer/index.html',
      'out/web/web-index.html'
    ],
    force,
    cache,
    nextCache,
    run: () => {
      runPnpm(['run', 'build:relay'], localEnvironment)
      runPnpm(['run', 'build:cli'], localEnvironment)
      runPnpm(['run', 'build:electron-vite'], localEnvironment)
      runPnpm(['run', 'build:web-from-renderer'], localEnvironment)
    }
  })

  buildCached({
    label: `Computer Use helper (${arch})`,
    key: 'computerHelper',
    fingerprint: `${arch}:${fingerprintInputs(repoRoot, [
      'config/scripts/build-computer-macos.mjs',
      'native/computer-use-macos',
      'resources/build/entitlements.computer-use.mac.plist',
      'resources/build/icon.icns'
    ])}`,
    outputs: ['native/computer-use-macos/.build/release/Orca Computer Use.app'],
    force,
    cache,
    nextCache,
    run: () =>
      runNode(['config/scripts/build-computer-macos.mjs', '--single-arch'], localEnvironment)
  })

  buildCached({
    label: `notification helper (${arch})`,
    key: 'notificationHelper',
    fingerprint: `${arch}:${fingerprintInputs(repoRoot, [
      'config/scripts/build-notification-status-macos.mjs',
      'native/notification-status-macos'
    ])}`,
    outputs: ['native/notification-status-macos/.build/release/orca-notification-status'],
    force,
    cache,
    nextCache,
    run: () =>
      runNode(
        ['config/scripts/build-notification-status-macos.mjs', '--single-arch'],
        localEnvironment
      )
  })

  writeCache(nextCache)
  runPnpm(['run', 'ensure:electron-runtime'], localEnvironment)
  const identity = getLocalBuildIdentity()
  const packageEnvironment = {
    ...localEnvironment,
    ORCA_BUILD_COMMIT: identity.commit,
    ORCA_LOCAL_BUILD_VERSION: identity.version,
    ORCA_REUSE_PREPARED_NATIVE_RUNTIME: '1'
  }
  const appOutputDir = path.join(repoRoot, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac')
  const appPath = path.join(appOutputDir, 'Orca Dev.app')
  // Why: failed signing can leave a partial app directory that electron-builder cannot replace.
  rmSync(appOutputDir, { recursive: true, force: true })
  console.log(`[package:mac] packaging ${arch} app`)
  runPnpm(localMacBuilderArgs(arch), packageEnvironment)
  verifyApp(appPath, arch)
  console.log(
    `[package:mac] ready in ${formatDuration(Date.now() - startedAt)}: ${path.relative(repoRoot, appPath)}`
  )
}

function buildCached({ label, key, fingerprint, outputs, force, cache, nextCache, run }) {
  if (!force && isBuildFresh(cache, key, fingerprint, outputs, repoRoot)) {
    console.log(`[package:mac] reuse ${label}`)
    return
  }
  console.log(`[package:mac] build ${label}`)
  run()
  nextCache[key] = fingerprint
  writeCache(nextCache)
}

function runPnpm(args, environment) {
  const pnpmCommand = process.env.npm_execpath
  if (pnpmCommand && existsSync(pnpmCommand)) {
    runCommand(process.execPath, [pnpmCommand, ...args], environment)
    return
  }
  runCommand(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, environment)
}

function runNode(args, environment) {
  runCommand(process.execPath, args, environment)
}

function runCommand(command, args, environment) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit'
  })
}

function verifyApp(appPath, arch) {
  if (!existsSync(appPath)) {
    throw new Error(`Packaging did not create the expected ${arch} app.`)
  }
  runCommand('codesign', ['--verify', '--deep', '--strict', appPath], process.env)
  const framework = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Electron Framework'
  )
  const architectures = execFileSync('lipo', ['-archs', framework], {
    encoding: 'utf8'
  }).trim()
  if (!architectures.split(/\s+/).includes(arch)) {
    throw new Error(`Packaged Electron Framework is ${architectures}, expected ${arch}.`)
  }
}

function readCache() {
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(value) {
  mkdirSync(path.dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  main()
}

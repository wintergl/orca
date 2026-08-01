import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export function restartPackageWithNode24({ scriptPath, args, cwd, environment }) {
  const node24 = findNode24(environment)
  if (!node24) {
    throw new Error(
      `package:mac requires Node 24 or newer; current Node is ${process.version}. Install Node 24 with nvm or set ORCA_NODE24_BIN.`
    )
  }
  console.log(`[package:mac] restart with ${node24}`)
  execFileSync(node24, [scriptPath, ...args], {
    cwd,
    env: environment,
    stdio: 'inherit'
  })
}

function findNode24(environment) {
  const explicit = environment.ORCA_NODE24_BIN
  if (explicit && isNode24(explicit)) {
    return explicit
  }
  const candidates = [
    ...nvmNodeCandidates(),
    '/opt/homebrew/opt/node@24/bin/node',
    '/usr/local/opt/node@24/bin/node'
  ]
  return candidates.find(isNode24) ?? null
}

function nvmNodeCandidates() {
  const versionsPath = path.join(homedir(), '.nvm', 'versions', 'node')
  if (!existsSync(versionsPath)) {
    return []
  }
  return readdirSync(versionsPath)
    .filter((name) => /^v24(?:\.|$)/.test(name))
    .toSorted((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((name) => path.join(versionsPath, name, 'bin', 'node'))
}

function isNode24(candidate) {
  if (!existsSync(candidate)) {
    return false
  }
  try {
    const major = execFileSync(candidate, ['-p', 'process.versions.node.split(".")[0]'], {
      encoding: 'utf8'
    }).trim()
    return Number(major) >= 24
  } catch {
    return false
  }
}

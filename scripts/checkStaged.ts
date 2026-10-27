// Pre-commit typecheck and unit tests, judged on what's staged. When the tree also holds unstaged
// or untracked changes, the index is exported to `.staged/` and checked there, so a partial commit
// passes or fails on its own contents and the working tree is never touched. `.staged/` sits in the
// repo so module resolution walks up to the real `node_modules`.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const checks = ['npm run typecheck', 'npm test']
const exportDir = '.staged'

/** Runs a shell command with inherited output; true when it exits cleanly. */
function run(command: string, cwd = '.'): boolean {
  return spawnSync(command, { cwd, shell: true, stdio: 'inherit' }).status === 0
}

function output(command: string): string {
  return spawnSync(command, { shell: true, encoding: 'utf8' }).stdout.trim()
}

const treeMatchesIndex =
  output('git diff --name-only') === '' && output('git ls-files --others --exclude-standard') === ''

let cwd = '.'
if (!treeMatchesIndex) {
  rmSync(exportDir, { recursive: true, force: true })
  if (!run(`git checkout-index --all --prefix=${exportDir}/`)) process.exit(1)
  cwd = exportDir
  console.warn(`Unstaged changes present: checking the staged snapshot in ${exportDir}/`)
}

const passed = checks.every((command) => run(command, cwd))
if (cwd !== '.') rmSync(exportDir, { recursive: true, force: true })
process.exit(passed ? 0 : 1)

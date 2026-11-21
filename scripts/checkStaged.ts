// Judges only what's staged: with other changes in the tree, checks an export of the index, so the
// tree is never touched. `.staged/` sits in the repo so module resolution finds `node_modules`.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

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
let unused = 'npm run unused'
if (!treeMatchesIndex) {
  rmSync(exportDir, { recursive: true, force: true })
  if (!run(`git checkout-index --all --prefix=${exportDir}/`)) process.exit(1)
  cwd = exportDir
  unused += ' -- --no-gitignore' // .gitignore lists .staged/, which hides every file from knip
  console.warn(`Unstaged changes present: checking the staged snapshot in ${exportDir}/`)
}

const checks = ['npm run typecheck', 'npm test', unused, 'npm run citations']
const passed = checks.every((command) => run(command, cwd))
if (cwd !== '.') rmSync(exportDir, { recursive: true, force: true })
process.exit(passed ? 0 : 1)

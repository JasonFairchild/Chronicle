// Lists each comment that uncommitted work adds or changes, file by file, for cr's comment question.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { fileComments } from './comments.ts'

function git(...args: string[]): string[] {
  return spawnSync('git', args, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
}

/** Each changed file's new line numbers, or `'all'` for an untracked file. */
function newLines(): Map<string, Set<number> | 'all'> {
  const changed = new Map<string, Set<number> | 'all'>()
  let lines = new Set<number>()
  for (const line of git('diff', 'HEAD', '--unified=0', '--no-color', '--diff-filter=d')) {
    if (line.startsWith('+++ b/')) {
      lines = new Set()
      changed.set(line.slice('+++ b/'.length), lines)
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk) continue
    const start = Number(hunk[1])
    for (let n = start; n < start + Number(hunk[2] ?? 1); n++) lines.add(n)
  }
  for (const path of git('ls-files', '--others', '--exclude-standard')) changed.set(path, 'all')
  return changed
}

let listed = 0
let multiLine = 0
for (const [path, added] of newLines()) {
  const found = fileComments(path, readFileSync(path, 'utf8'))
  if (!found) continue
  for (const { start, end, text } of found) {
    const lines = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
    if (added !== 'all' && !lines.some((line) => added.has(line))) continue
    const where = end > start ? `${start}-${end} (${end - start + 1} lines)` : `${start}`
    process.stdout.write(`${path}:${where}\n${text}\n\n`)
    listed++
    if (end > start) multiLine++
  }
}
process.stdout.write(`${listed} comments added or changed, ${multiLine} of more than one line.\n`)

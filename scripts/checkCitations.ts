// Fails when a citation between docs, skills and code comments lands nowhere, shows a stale number,
// or repeats in one code file; lists those matching only the start of a title.
import { checkCitations, readRepo } from './citations.ts'

const report = checkCitations(readRepo())
for (const p of report.problems) console.error(`${p.file}:${p.line}  ${p.kind}: ${p.detail}`)
if (report.prefixOnly.length) {
  console.log('Matching only the start of a title:')
  for (const p of report.prefixOnly) console.log(`  ${p.file}:${p.line}  ${p.detail}`)
}
console.log(`${report.citations} citations, ${report.problems.length} problems`)
process.exit(report.problems.length ? 1 : 0)

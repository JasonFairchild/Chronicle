// Prints each problem `checkCitations` finds among the repo's citations, and fails if there is one.
import { checkCitations, readGitHead, readRepo } from './citations.ts'

const files = readRepo()
const report = checkCitations(files, readGitHead(files.keys()))
for (const p of report.problems) console.error(`${p.file}:${p.line}  ${p.kind}: ${p.detail}`)
console.log(`${report.citations} citations, ${report.problems.length} problems`)
process.exit(report.problems.length ? 1 : 0)

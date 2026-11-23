// Prints the section or rule a citation lands on, so it can be read without its whole file.
import { citedText, readRepo } from './citations.ts'

const citation = process.argv.slice(2).join(' ')
const cited = citedText(readRepo(), citation)
if (!cited) {
  console.error(`${citation} lands nowhere`)
  process.exit(1)
}
console.log(`${cited.doc}:${cited.line}\n${cited.text}`)

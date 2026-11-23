// Claude Code PreToolUse hook: reminds the agent to load the skill governing a file it edits, until it has.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  transcript_path?: string
  tool_input?: { file_path?: string }
}
const path = input.tool_input?.file_path ?? ''

/** Whether git tracks or would track the file: false outside the repo, and for an ignored one. */
function checkedIn(file: string): boolean {
  return (
    spawnSync('git', ['check-ignore', '-q', file], { cwd: process.env.CLAUDE_PROJECT_DIR })
      .status === 1
  )
}

const rules = [
  {
    skill: 'write-tests',
    edits: 'a spec',
    test: (p: string) => /\.(test|cy|contract)\.ts$/.test(p),
  },
  {
    skill: 'write-docs',
    edits: 'a checked-in doc, plan or skill',
    test: (p: string) => p.endsWith('.md') && checkedIn(p),
  },
]
const rule = rules.find(({ test }) => test(path))
if (!rule) process.exit(0)

let transcript = ''
try {
  transcript = readFileSync(input.transcript_path ?? '', 'utf8')
} catch {
  // No transcript to read, so remind regardless.
}
// Loaded by the agent through the Skill tool, or by the user as a slash command.
const loaded = [`"name":"Skill","input":{"skill":"${rule.skill}"`, `<command-name>/${rule.skill}<`]
if (loaded.some((marker) => transcript.includes(marker))) process.exit(0)

const additionalContext = `This edits ${rule.edits}. Load the ${rule.skill} skill first, whether the change is new or not.`
console.log(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }),
)

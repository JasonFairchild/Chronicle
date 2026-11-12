// Preloaded into every Node process an npm script starts (.npmrc). VS Code hands out "c:" paths,
// and tools that key caches or module identity on path strings then see a second project.

import { registerHooks } from 'node:module'

const upperDrive = (path: string) =>
  path.replace(/^(file:\/\/\/)?([a-z]):/, (_, scheme = '', drive: string) => {
    return `${scheme}${drive.toUpperCase()}:`
  })

process.chdir(upperDrive(process.cwd()))

// Node names the entry script before this runs, still "c:" when npm's bin shim says so, and the
// working directory alone then leaves Vitest loaded twice.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    return { ...resolved, url: upperDrive(resolved.url) }
  },
})

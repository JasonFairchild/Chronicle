// Preloaded into every Node process npm starts (.npmrc), to undo what VS Code passes down.

import { registerHooks } from 'node:module'

// VS Code hands out "c:" paths, and tools keying caches on path strings then see a second project.
const upperDrive = (path: string) =>
  path.replace(/^(file:\/\/\/)?([a-z]):/, (_, scheme = '', drive: string) => {
    return `${scheme}${drive.toUpperCase()}:`
  })

process.chdir(upperDrive(process.cwd()))

// Node names the entry script "c:" before this runs, so the cwd fix alone loads Vitest twice.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    return { ...resolved, url: upperDrive(resolved.url) }
  },
})

// Set by VS Code's extension host, and `cypress run` then fails to start its Electron app.
delete process.env.ELECTRON_RUN_AS_NODE

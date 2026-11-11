// Preloaded into every Node process an npm script starts (.npmrc). VS Code hands out "c:" paths,
// and tools that key caches or module identity on path strings then see a second project.
process.chdir(process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase()))

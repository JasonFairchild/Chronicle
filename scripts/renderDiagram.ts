/**
 * Renders ARCHITECTURE.md's Mermaid diagram to light and dark PNGs, to check its layout before
 * handing it over. Mermaid and its ELK layout load from jsdelivr into the project's Playwright
 * Chromium, the same pairing VS Code's preview uses. Writes to the OS temp directory unless given a
 * directory as the first argument.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? join(tmpdir(), 'chronicle-diagram')
const markdown = readFileSync('ARCHITECTURE.md', 'utf8').replace(/\r\n/g, '\n')
const source = /```mermaid\n([\s\S]*?)```/.exec(markdown)?.[1]
if (!source) throw new Error('ARCHITECTURE.md has no mermaid block')

const urls = {
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs',
  elk: 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs',
}
const themes = [
  { name: 'light', mermaidTheme: 'default', background: '#ffffff' },
  { name: 'dark', mermaidTheme: 'dark', background: '#1e1e1e' },
]

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const { name, mermaidTheme, background } of themes) {
    const page = await browser.newPage()
    // Rendered in one page and shown in a fresh one, so the screenshot holds the SVG alone.
    const svg: string = await page.evaluate(
      async ({ source, mermaidTheme, urls }) => {
        const { default: mermaid } = await import(urls.mermaid)
        const { default: elkLayouts } = await import(urls.elk)
        mermaid.registerLayoutLoaders(elkLayouts)
        mermaid.initialize({ startOnLoad: false, theme: mermaidTheme })
        return (await mermaid.render('architecture', source)).svg
      },
      { source, mermaidTheme, urls },
    )
    await page.setContent(
      `<body style="margin: 0; padding: 16px; background: ${background}">${svg}</body>`,
    )
    const path = join(outDir, `architecture-${name}.png`)
    await page.screenshot({ path, fullPage: true })
    process.stdout.write(`${path}\n`)
  }
} finally {
  await browser.close()
}

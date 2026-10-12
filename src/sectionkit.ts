import type { DocType, PaperSize, FontSize } from './types'

// Load all .tex design files at build time via Vite's glob import.
// With `import: 'default'`, each entry resolves to the default export value
// (the raw string) directly, but some bundlers wrap it as `{ default }`, so
// `getDesigns` handles both shapes.
const designModules = import.meta.glob<string | { default: string }>('./designs/*.tex', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export interface Design {
  id: string
  name: string
  raw: string
}

/**
 * Convert a filename like "bar.tex" to a display name "Bar".
 */
function titleCaseFilename(filename: string): string {
  const base = filename.replace(/\.tex$/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/**
 * Get all available designs, sorted with "Default" first, then alphabetically.
 */
export function getDesigns(): Design[] {
  const designs: Design[] = []
  for (const [path, mod] of Object.entries(designModules)) {
    const filename = path.split('/').pop() ?? path
    designs.push({
      id: filename.replace(/\.tex$/, ''),
      name: titleCaseFilename(filename),
      raw: typeof mod === 'string' ? mod : mod.default,
    })
  }
  designs.sort((a, b) => a.name.localeCompare(b.name))
  return designs
}

/**
 * Find a design by its ID.
 */
export function getDesignById(id: string): Design | undefined {
  return getDesigns().find((d) => d.id === id)
}

/**
 * Extract the preamble from a LaTeX document.
 * - Takes everything before \begin{document}
 * - Drops the \documentclass line
 * - Drops \usepackage[...]{geometry}
 * - Drops any \usepackage line mentioning lmodern, newpxtext, or newpxmath
 * - Keeps everything else (xcolor, tikz, titlesec, etc.)
 */
export function extractPreamble(raw: string): string {
  const beginDocIndex = raw.indexOf('\\begin{document}')
  if (beginDocIndex === -1) return ''

  const preamble = raw.slice(0, beginDocIndex)
  const lines = preamble.split('\n')

  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    // Drop \documentclass line
    if (trimmed.startsWith('\\documentclass')) return false
    // Drop \usepackage[...]{geometry}
    if (trimmed.match(/^\\usepackage\s*\[.*\]\s*\{geometry\}/)) return false
    // Drop \usepackage{geometry} (without options)
    if (trimmed.match(/^\\usepackage\s*\{geometry\}/)) return false
    // Drop any \usepackage mentioning lmodern, newpxtext, newpxmath
    if (trimmed.match(/^\\usepackage/) && /lmodern|newpxtext|newpxmath/i.test(trimmed)) return false
    return true
  })

  return filtered.join('\n').trim()
}

/**
 * Build a complete LaTeX document from parts.
 */
export function buildDocument(params: {
  docType: DocType
  paper: PaperSize
  fontSize: FontSize
  geometryOptions: string
  preamble: string
  body: string
}): string {
  const { docType, paper, fontSize, geometryOptions, preamble, body } = params
  const parts: string[] = []
  parts.push(`\\documentclass[${fontSize}, ${paper}]{${docType}}`)
  parts.push(`\\usepackage[${geometryOptions}]{geometry}`)
  if (preamble) parts.push(preamble)
  parts.push('\\begin{document}')
  parts.push(body)
  parts.push('\\end{document}')
  return parts.join('\n\n')
}

/**
 * Sample body for thumbnail generation.
 */
export const SAMPLE_BODY = `\\section{Sample Section}
\\subsection{Sample Subsection}
\\subsubsection{Sample Subsubsection}`
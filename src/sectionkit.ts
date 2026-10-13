import type { DocType, PaperSize, FontSize, Spacing, SpacingTarget } from './types'
import { DEFAULT_SPACING, SPACING_TARGETS } from './types'

// Load all .tex design files at build time via Vite's glob import.
// With `import: 'default'`, each entry resolves to the default export value
// (the raw string) directly, but some bundlers wrap it as `{ default }`, so
// `getDesigns` handles both shapes.
const designModules = import.meta.glob<string | { default: string }>('./designs/*.tex', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Load static preview SVGs as URLs (hashed by Vite for caching)
const previewModules = import.meta.glob<string>('./assets/sectionkit/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
})

export interface Design {
  id: string
  name: string
  raw: string
  previewUrl?: string
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
 * Attaches previewUrl from the generated SVG assets.
 */
export function getDesigns(): Design[] {
  const designs: Design[] = []
  for (const [path, mod] of Object.entries(designModules)) {
    const filename = path.split('/').pop() ?? path
    const id = filename.replace(/\.tex$/, '')
    const raw = typeof mod === 'string' ? mod : mod.default
    // Match preview by design id (e.g., bar -> ./assets/sectionkit/bar.svg)
    const previewKey = Object.keys(previewModules).find((k) => k.includes(`/${id}.svg`))
    const previewUrl = previewKey ? previewModules[previewKey] : undefined
    designs.push({ id, name: titleCaseFilename(filename), raw, previewUrl })
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

/** Characters removed from a spacing value (braces/backslashes/newlines/etc.). */
const SPACING_DISALLOWED = /[^0-9a-zA-Z.+\- ]/g

/** Clean a user-entered spacing value; fall back when empty. */
export function sanitizeSpacing(value: string, fallback: string): string {
  const cleaned = value.replace(SPACING_DISALLOWED, '').replace(/\s+/g, ' ').trim()
  return cleaned || fallback
}

/** Read a preamble's `\titlespacing*` values so the popup shows the design's numbers. */
export function parseTitlespacing(preamble: string): Spacing {
  const spacing: Spacing = {
    section: { ...DEFAULT_SPACING.section },
    subsection: { ...DEFAULT_SPACING.subsection },
    subsubsection: { ...DEFAULT_SPACING.subsubsection },
    parskip: DEFAULT_SPACING.parskip,
    parindent: DEFAULT_SPACING.parindent,
  }
  const pattern =
    /\\titlespacing\*?\s*\{\s*\\(subsubsection|subsection|section)\s*\}\s*\{([^{}]*)\}\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g
  for (const match of preamble.matchAll(pattern)) {
    const target = match[1] as SpacingTarget
    spacing[target] = {
      left: match[2].trim() || DEFAULT_SPACING[target].left,
      before: match[3].trim() || DEFAULT_SPACING[target].before,
      after: match[4].trim() || DEFAULT_SPACING[target].after,
    }
  }
  return spacing
}

/** Whether a preamble can accept `\titlespacing` (i.e. loads titlesec). */
export function hasTitlesec(preamble: string): boolean {
  if (/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\btitlesec\b[^}]*\}/.test(preamble)) return true
  return /\\titlespacing\b/.test(preamble)
}

/** Render spacing controls as preamble LaTeX. setlength always; titlespacing only if includeTitlespacing. */
export function buildSpacingLatex(spacing: Spacing, includeTitlespacing: boolean): string {
  const lines: string[] = []
  if (includeTitlespacing) {
    for (const target of SPACING_TARGETS) {
      const title = spacing[target]
      const fallback = DEFAULT_SPACING[target]
      lines.push(
        `\\titlespacing*{\\${target}}{${sanitizeSpacing(title.left, fallback.left)}}` +
          `{${sanitizeSpacing(title.before, fallback.before)}}` +
          `{${sanitizeSpacing(title.after, fallback.after)}}`,
      )
    }
  }
  lines.push(`\\setlength{\\parskip}{${sanitizeSpacing(spacing.parskip, DEFAULT_SPACING.parskip)}}`)
  lines.push(`\\setlength{\\parindent}{${sanitizeSpacing(spacing.parindent, DEFAULT_SPACING.parindent)}}`)
  return lines.join('\n')
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
  spacingPreamble?: string
}): string {
  const { docType, paper, fontSize, geometryOptions, preamble, body, spacingPreamble } = params
  const parts: string[] = []
  parts.push(`\\documentclass[${fontSize}, ${paper}]{${docType}}`)
  parts.push(`\\usepackage[${geometryOptions}]{geometry}`)
  if (preamble) parts.push(preamble)
  if (spacingPreamble) parts.push(spacingPreamble)
  parts.push('\\begin{document}')
  parts.push(body)
  parts.push('\\end{document}')
  return parts.join('\n\n')
}
import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent, Range } from '@tiptap/core'
import 'computer-modern/cmu-serif.css'

type DocType = 'article' | 'report' | 'book'

const HEADING_LABELS: Record<DocType, string[]> = {
  article: ['Section', 'Subsection', 'Subsubsection'],
  report: ['Chapter', 'Section', 'Subsection'],
  book: ['Chapter', 'Section', 'Subsection'],
}

type PaperSize = 'a4paper' | 'letterpaper' | 'legalpaper' | 'a5paper'
const PAPER_SIZES: Record<PaperSize, { label: string; widthMm: number; heightMm: number }> = {
  a4paper: { label: 'A4 (210×297 mm)', widthMm: 210, heightMm: 297 },
  letterpaper: { label: 'Letter (215.9×279.4 mm)', widthMm: 215.9, heightMm: 279.4 },
  legalpaper: { label: 'Legal (215.9×355.6 mm)', widthMm: 215.9, heightMm: 355.6 },
  a5paper: { label: 'A5 (148×210 mm)', widthMm: 148, heightMm: 210 },
}
const PAPER_ORDER: PaperSize[] = ['a4paper', 'letterpaper', 'legalpaper', 'a5paper']

const FONT_SIZES = ['10pt', '11pt', '12pt'] as const
type FontSize = (typeof FONT_SIZES)[number]

const DEFAULT_MARGIN = '1in'
const MARGIN_KEYS = ['top', 'bottom', 'left', 'right'] as const
type MarginKey = (typeof MARGIN_KEYS)[number]
type Margins = Record<MarginKey, string>
type Geometry = { uniform: boolean; margin: string; margins: Margins }
const MARGIN_LABELS: Record<MarginKey, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' }
const DEFAULT_MARGINS: Margins = { top: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN, right: DEFAULT_MARGIN }

type Mark = { type: string }
type JNode = {
  type: string
  attrs?: { level?: number }
  content?: JNode[]
  text?: string
  marks?: Mark[]
}

const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}
const escapeLatex = (s: string) => s.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c])

const renderText = (n: JNode) => {
  let out = escapeLatex(n.text ?? '')
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') out = `\\textbf{${out}}`
    else if (m.type === 'italic') out = `\\textit{${out}}`
  }
  return out
}

const renderInline = (nodes: JNode[] = []) =>
  nodes.filter((n) => n.type === 'text').map(renderText).join('')

const renderBlock = (n: JNode, docType: DocType): string => {
  if (n.type === 'paragraph') return renderInline(n.content)
  if (n.type === 'heading') {
    const level = n.attrs?.level ?? 1
    const cmd = HEADING_LABELS[docType][level - 1].toLowerCase()
    return `\\${cmd}{${renderInline(n.content)}}`
  }
  return `% unsupported: ${n.type}`
}

// Sanitize margin values so they never break the LaTeX optional argument.
const sanitizeMargin = (value: string): string => {
  const cleaned = value.replaceAll('[', '').replaceAll(']', '').replace(/[\r\n]/g, '').trim()
  return cleaned || DEFAULT_MARGIN
}

// Build the geometry package option string.
const geometryOptions = ({ uniform, margin, margins }: Geometry): string =>
  uniform
    ? `margin=${sanitizeMargin(margin)}`
    : [
        `top=${sanitizeMargin(margins.top)}`,
        `bottom=${sanitizeMargin(margins.bottom)}`,
        `left=${sanitizeMargin(margins.left)}`,
        `right=${sanitizeMargin(margins.right)}`,
      ].join(', ')

// Convert a length like "1in" or "2.5cm" to millimetres. Falls back to 25.4mm
// (≈1in) if the value is empty, unparseable, or uses an unknown unit.
// Rounds to 3 decimal places and clamps negative values to 0.
const MM_PER_UNIT: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
}
const DEFAULT_MARGIN_MM = 25.4
const marginToMm = (value: string): number => {
  const match = /^(-?\d*\.?\d+)\s*(mm|cm|in|pt|pc|px)$/i.exec(sanitizeMargin(value))
  const mm = match ? Number(match[1]) * MM_PER_UNIT[match[2].toLowerCase()] : NaN
  if (!Number.isFinite(mm)) return DEFAULT_MARGIN_MM
  return Math.max(0, Math.round(mm * 1000) / 1000)
}

const toLatex = (
  doc: JNode,
  docType: DocType,
  paperSize: PaperSize,
  fontSize: FontSize,
  geometry: Geometry,
) => {
  const body = (doc.content ?? [])
    .map((n) => renderBlock(n, docType))
    .filter(Boolean)
    .join('\n\n')

  const preamble = `\\usepackage[${geometryOptions(geometry)}]{geometry}`
  return `\\documentclass[${fontSize}, ${paperSize}]{${docType}}\n\n${preamble}\n\n\\begin{document}\n\n${body}\n\n\\end{document}`
}

const BODY_PLACEHOLDER = 'Please insert your text here...'
const headingPlaceholder = (label: string) => `THIS IS ${label.toUpperCase()}`

const headingBlock = (level: 1 | 2 | 3, label: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text: headingPlaceholder(label) }],
})

const paragraphBlock = (): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text: BODY_PLACEHOLDER }],
})

const Tiptap = () => {
  const [docType, setDocType] = useState<DocType>('article')
  const [paperSize, setPaperSize] = useState<PaperSize>('a4paper')
  const [fontSize, setFontSize] = useState<FontSize>('12pt')
  const [uniform, setUniform] = useState(true)
  const [margin, setMargin] = useState(DEFAULT_MARGIN)
  const [margins, setMargins] = useState<Margins>(DEFAULT_MARGINS)
  const [showGrid, setShowGrid] = useState(false)
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        trailingNode: false,
      }),
    ],
    content: '',
  })

  const json = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? (editor.getJSON() as unknown as JNode) : null),
  })
  const geometry: Geometry = { uniform, margin, margins }
  const code = json ? toLatex(json, docType, paperSize, fontSize, geometry) : ''

  const paper = PAPER_SIZES[paperSize]
  const pageWidthPx = (paper.widthMm / 25.4) * 96
  const pageHeightPx = (paper.heightMm / 25.4) * 96

  // Compute CSS padding for the preview page from the margin values.
  const pagePadding = uniform
    ? `${marginToMm(margin)}mm`
    : [
        marginToMm(margins.top),
        marginToMm(margins.right),
        marginToMm(margins.bottom),
        marginToMm(margins.left),
      ]
        .map((mm) => `${mm}mm`)
        .join(' ')

  // Scale the sheet down so the whole page stays visible inside the preview
  // pane instead of being clipped by the LaTeX code panel beside it.
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const update = () => {
      const available = el.clientWidth - 32 // minus the pane's 16px padding
      setScale(available > 0 ? Math.min(1, available / pageWidthPx) : 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pageWidthPx])

  // Track the real rendered page height so the scaled wrapper reserves the
  // correct vertical space (CSS transforms do not affect layout size).
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const update = () => setContentHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Toggle uniform margins, carrying the value over.
  const toggleUniform = (checked: boolean) => {
    setUniform(checked)
    if (checked) setMargin(sanitizeMargin(margins.top))
    else {
      const value = sanitizeMargin(margin)
      setMargins({ top: value, bottom: value, left: value, right: value })
    }
  }
  const setMarginSide = (key: MarginKey, value: string) =>
    setMargins((prev) => ({ ...prev, [key]: value }))

  // Insert a block at the end, swallowing any trailing empty textblocks
  // (the source of stray blank paragraphs when TrailingNode was on).
  const insertBlock = (node: JSONContent) => {
    if (!editor) return
    const { doc } = editor.state
    let from = doc.content.size
    for (let i = doc.childCount - 1; i >= 0; i -= 1) {
      const child = doc.child(i)
      if (!child.isTextblock || child.content.size > 0) break
      from -= child.nodeSize
    }
    const range: Range = { from, to: doc.content.size }
    editor.chain().focus().insertContentAt(range, node, { updateSelection: true }).run()
  }

  return (
    <div style={{ textAlign: 'left', padding: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          aria-label="Document type"
          title="Document type"
        >
          <option value="article">Article</option>
          <option value="report">Report</option>
          <option value="book">Book</option>
        </select>
        <select
          value={paperSize}
          onChange={(e) => setPaperSize(e.target.value as PaperSize)}
          aria-label="Paper size"
          title="Paper size"
        >
          {PAPER_ORDER.map((p) => (
            <option key={p} value={p}>
              {PAPER_SIZES[p].label}
            </option>
          ))}
        </select>
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          aria-label="Font size"
          title="Font size"
        >
          {FONT_SIZES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={uniform}
            onChange={(e) => toggleUniform(e.target.checked)}
            aria-label="Uniform"
          />
          Uniform
        </label>
        {uniform ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Margin
            <input
              type="text"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              aria-label="Margin"
              style={{ width: 64 }}
            />
          </label>
        ) : (
          MARGIN_KEYS.map((key) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {MARGIN_LABELS[key]}
              <input
                type="text"
                value={margins[key]}
                onChange={(e) => setMarginSide(key, e.target.value)}
                aria-label={`${MARGIN_LABELS[key]} margin`}
                style={{ width: 56 }}
              />
            </label>
          ))
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          Show grid
        </label>
        <div className="block-inserter" role="group" aria-label="Insert block">
          <button
            type="button"
            onClick={() => insertBlock(paragraphBlock())}
            disabled={!editor}
          >
            Normal text
          </button>
          {HEADING_LABELS[docType].map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => insertBlock(headingBlock((i + 1) as 1 | 2 | 3, label))}
              disabled={!editor}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-layout">
        <div ref={previewRef} className="editor-preview">
          <div
            style={{
              width: pageWidthPx * scale,
              height: Math.max(contentHeight, pageHeightPx) * scale,
              margin: '0 auto',
              position: 'relative',
            }}
          >
            <div
              ref={pageRef}
              className="latex-page"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                background: '#fff',
                ...(showGrid
                  ? {
                      backgroundImage: `repeating-linear-gradient(0deg, #eee 0, #eee 1px, transparent 1px, transparent 20px), repeating-linear-gradient(90deg, #eee 0, #eee 1px, transparent 1px, transparent 20px)`,
                      backgroundSize: '20px 20px',
                      // Start the grid at the margin and clip it there, so the
                      // grid fills only the text area and the margins stay blank.
                      backgroundOrigin: 'content-box',
                      backgroundClip: 'content-box',
                    }
                  : {}),
                color: '#000',
                fontFamily: '"CMU Serif", serif',
                fontSize,
                lineHeight: 1.45,
                width: `${paper.widthMm}mm`,
                minHeight: `${paper.heightMm}mm`,
                padding: pagePadding,
                boxSizing: 'border-box',
                boxShadow: '0 0 6px rgba(0,0,0,0.3)',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
        <pre className="editor-code">{code}</pre>
      </div>
    </div>
  )
}

export default Tiptap
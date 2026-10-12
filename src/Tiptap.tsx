import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
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

// A text box positioned on the page, in millimetres from the paper's top-left.
type PlacedText = { id: number; xMm: number; yMm: number; text: string }

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
  placed: PlacedText[],
  geometry: Geometry,
) => {
  const body = (doc.content ?? [])
    .map((n) => renderBlock(n, docType))
    .filter(Boolean)
    .join('\n\n')

  const positioned = placed
    .filter((t) => t.text.trim().length > 0)
    .map((t) => {
      const widthMm = Math.max(20, PAPER_SIZES[paperSize].widthMm - t.xMm)
      return `\\begin{textblock*}{${widthMm.toFixed(1)}mm}(${t.xMm.toFixed(1)}mm,${t.yMm.toFixed(1)}mm)\n${escapeLatex(t.text)}\n\\end{textblock*}`
    })
    .join('\n\n')

  const preamble = [
    `\\usepackage[${geometryOptions(geometry)}]{geometry}`,
    positioned ? '\\usepackage[absolute,overlay]{textpos}' : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const content = [body, positioned].filter(Boolean).join('\n\n')
  return `\\documentclass[${fontSize}, ${paperSize}]{${docType}}\n\n${preamble}\n\n\\begin{document}\n\n${content}\n\n\\end{document}`
}

const Tiptap = () => {
  const [docType, setDocType] = useState<DocType>('article')
  const [paperSize, setPaperSize] = useState<PaperSize>('a4paper')
  const [fontSize, setFontSize] = useState<FontSize>('12pt')
  const [uniform, setUniform] = useState(true)
  const [margin, setMargin] = useState(DEFAULT_MARGIN)
  const [margins, setMargins] = useState<Margins>(DEFAULT_MARGINS)
  const [showGrid, setShowGrid] = useState(false)
  const [writeMode, setWriteMode] = useState(false)
  const [placed, setPlaced] = useState<PlacedText[]>([])
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const focusId = useRef<number | null>(null)

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: '<p>WELCOME TO LATEX EDITOR</p>',
  })

  const json = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? (editor.getJSON() as unknown as JNode) : null),
  })
  const geometry: Geometry = { uniform, margin, margins }
  const code = json ? toLatex(json, docType, paperSize, fontSize, placed, geometry) : ''

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

  // Live-update a placed box as the user types, so the LaTeX code refreshes
  // immediately, and drop the box on blur if nothing was entered.
  const updatePlaced = (id: number, text: string) => {
    setPlaced((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)))
  }
  const commitPlaced = (id: number, text: string) => {
    if (!text.trim()) setPlaced((prev) => prev.filter((t) => t.id !== id))
  }

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

  // Drag a placed box to a new spot on the page. Its millimetre coordinates
  // update live, so the LaTeX textblock moves with it.
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, t: PlacedText) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const origX = t.xMm
    const origY = t.yMm
    const move = (e: PointerEvent) => {
      const xMm = origX + ((e.clientX - startX) / scale / 96) * 25.4
      const yMm = origY + ((e.clientY - startY) / scale / 96) * 25.4
      setPlaced((prev) =>
        prev.map((p) =>
          p.id === t.id
            ? {
                ...p,
                xMm: Math.min(Math.max(0, xMm), Math.max(0, paper.widthMm - 15)),
                yMm: Math.min(Math.max(0, yMm), Math.max(0, paper.heightMm - 8)),
              }
            : p,
        ),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // "Write text" tool: when armed, a click anywhere on the sheet drops a text
  // box at exactly that point (in page millimetres) and focuses it so typing
  // starts immediately. The box is emitted to LaTeX at the same coordinates.
  const handleWriteText = (event: MouseEvent<HTMLDivElement>) => {
    if (!writeMode || !pageRef.current) return
    if ((event.target as HTMLElement).closest('[data-placed]')) return
    event.preventDefault()
    const rect = pageRef.current.getBoundingClientRect()
    const xPx = (event.clientX - rect.left) / scale
    const yPx = (event.clientY - rect.top) / scale
    const id = nextId.current++
    focusId.current = id
    setPlaced((prev) => [
      ...prev,
      { id, xMm: (xPx / 96) * 25.4, yMm: (yPx / 96) * 25.4, text: '' },
    ])
    setWriteMode(false)
  }

  // After a new box is rendered, focus it and put the caret at the end.
  useEffect(() => {
    const id = focusId.current
    if (id == null) return
    const el = document.getElementById(`placed-${id}`)
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    focusId.current = null
  })

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
        <button
          type="button"
          onClick={() => setWriteMode((v) => !v)}
          aria-pressed={writeMode}
          title="Write text: click this, then click anywhere on the page to place text exactly there"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            ...(writeMode ? { background: '#aa3bff', color: '#fff', borderColor: '#aa3bff' } : {}),
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          {writeMode ? 'Click on the page…' : 'Write text'}
        </button>
        {HEADING_LABELS[docType].map((label, i) => (
          <button
            key={label}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: (i + 1) as 1 | 2 | 3 }).run()
            }
          >
            {label}
          </button>
        ))}
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
              onClick={handleWriteText}
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
                cursor: writeMode ? 'crosshair' : undefined,
              }}
            >
              <EditorContent editor={editor} />
              {placed.map((t) => (
                <div
                  key={t.id}
                  data-placed="true"
                  style={{
                    position: 'absolute',
                    left: `${t.xMm}mm`,
                    top: `${t.yMm}mm`,
                    maxWidth: `${Math.max(20, paper.widthMm - t.xMm)}mm`,
                  }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => startDrag(e, t)}
                    title="Drag to move this text"
                    aria-label="Drag to move this text"
                    style={{
                      position: 'absolute',
                      left: -20,
                      top: 0,
                      width: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      border: 'none',
                      borderRadius: 4,
                      background: 'rgba(170,59,255,0.85)',
                      color: '#fff',
                      cursor: 'move',
                      touchAction: 'none',
                      lineHeight: 1,
                    }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="2" cy="2" r="1" />
                      <circle cx="5" cy="2" r="1" />
                      <circle cx="8" cy="2" r="1" />
                      <circle cx="2" cy="5" r="1" />
                      <circle cx="5" cy="5" r="1" />
                      <circle cx="8" cy="5" r="1" />
                      <circle cx="2" cy="8" r="1" />
                      <circle cx="5" cy="8" r="1" />
                      <circle cx="8" cy="8" r="1" />
                    </svg>
                  </button>
                  <div
                    id={`placed-${t.id}`}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onInput={(e) => updatePlaced(t.id, e.currentTarget.textContent ?? '')}
                    onBlur={(e) => commitPlaced(t.id, e.currentTarget.textContent ?? '')}
                    style={{
                      minWidth: '15mm',
                      whiteSpace: 'pre-wrap',
                      outline: '1px dashed rgba(170,59,255,0.5)',
                      cursor: 'text',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <pre className="editor-code">{code}</pre>
      </div>
    </div>
  )
}

export default Tiptap
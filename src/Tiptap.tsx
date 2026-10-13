import { useEffect, useRef, useState, useMemo } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent, Range } from '@tiptap/core'
import 'computer-modern/cmu-serif.css'
import { SectionKitPicker } from './SectionKitPicker'
import { SpacingPanel } from './SpacingPanel'
import { useCompiledPreview } from './useCompiledPreview'
import { getDesignById, extractPreamble, buildDocument, parseTitlespacing, hasTitlesec, buildSpacingLatex } from './sectionkit'
import type { DocType, PaperSize, FontSize, Geometry, MarginKey, Margins, Spacing } from './types'
import {
  HEADING_LABELS,
  PAPER_SIZES,
  PAPER_ORDER,
  FONT_SIZES,
  DEFAULT_MARGIN,
  MARGIN_KEYS,
  MARGIN_LABELS,
  DEFAULT_MARGINS,
  DEFAULT_SPACING,
} from './types'

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

const sanitizeMargin = (value: string): string => {
  const cleaned = value.replaceAll('[', '').replaceAll(']', '').replace(/[\r\n]/g, '').trim()
  return cleaned || DEFAULT_MARGIN
}

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

const geometryOptions = ({ uniform, margin, margins }: Geometry): string =>
  uniform
    ? `margin=${sanitizeMargin(margin)}`
    : [
        `top=${sanitizeMargin(margins.top)}`,
        `bottom=${sanitizeMargin(margins.bottom)}`,
        `left=${sanitizeMargin(margins.left)}`,
        `right=${sanitizeMargin(margins.right)}`,
      ].join(', ')

const toLatex = (
  doc: JNode,
  docType: DocType,
  paperSize: PaperSize,
  fontSize: FontSize,
  geometry: Geometry,
  designPreamble = '',
  spacing: Spacing = DEFAULT_SPACING,
  headingSpacing = false,
): string => {
  const body = (doc.content ?? [])
    .map((n) => renderBlock(n, docType))
    .filter(Boolean)
    .join('\n\n')

  const geoOpts = geometryOptions(geometry)
  return buildDocument({
    docType,
    paper: paperSize,
    fontSize,
    geometryOptions: geoOpts,
    preamble: designPreamble,
    body,
    spacingPreamble: buildSpacingLatex(spacing, headingSpacing),
  })
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

const DEFAULT_DESIGN_ID = 'default'

type PaneTab = 'preview' | 'code'

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
  const [designId, setDesignId] = useState<string>(DEFAULT_DESIGN_ID)
  const [activePaneTab, setActivePaneTab] = useState<PaneTab>('preview')
  const [svgBlobUrls, setSvgBlobUrls] = useState<string[]>([])
  const svgBlobUrlsRef = useRef<string[]>([])
  const previewRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const editorPageRef = useRef<HTMLDivElement>(null)
  const [editorScale, setEditorScale] = useState(1)
  const [editorContentHeight, setEditorContentHeight] = useState(0)

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

  // Get selected design and extract its preamble
  const design = useMemo(() => (designId === DEFAULT_DESIGN_ID ? null : getDesignById(designId)), [designId])
  const designPreamble = useMemo(() => (design ? extractPreamble(design.raw) : ''), [design])

  // Spacing: the design's own \titlespacing values, overridden by user edits
  // for the design that is currently selected. Derived (not synced via effect),
  // so switching designs automatically falls back to that design's values.
  const [spacingEdits, setSpacingEdits] = useState<{ designId: string; value: Spacing } | null>(null)
  const designSpacing = useMemo(() => parseTitlespacing(designPreamble), [designPreamble])
  const spacingEnabled = useMemo(() => hasTitlesec(designPreamble), [designPreamble])
  const spacing = spacingEdits?.designId === designId ? spacingEdits.value : designSpacing
  const setSpacing = (value: Spacing) => setSpacingEdits({ designId, value })
  const resetSpacing = () => setSpacingEdits(null)

  const code = json
    ? toLatex(json, docType, paperSize, fontSize, geometry, designPreamble, spacing, spacingEnabled)
    : ''

  // Compilation is manual: Ctrl/Cmd+S only — typing never compiles.
  const { pages, loading, error, dirty, compile } = useCompiledPreview(code)

  // Ctrl+S / Cmd+S compiles the current LaTeX. Capture phase so it fires while
  // focus is inside the Tiptap contenteditable; `compile` reads the latest code.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void compile()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [compile])

  // Manage SVG blob URLs for preview
  useEffect(() => {
    // Revoke old URLs
    for (const url of svgBlobUrlsRef.current) {
      URL.revokeObjectURL(url)
    }
    const newUrls = pages.map((svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })))
    svgBlobUrlsRef.current = newUrls
    // Syncing blob URLs is an external-system side effect; state is required
    // so the preview can render the <img> elements.
    // oxlint-disable-next-line react/set-state-in-effect
    setSvgBlobUrls(newUrls)
    return () => {
      for (const url of newUrls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [pages])

  const paper = PAPER_SIZES[paperSize]
  const pageWidthPx = (paper.widthMm / 25.4) * 96
  const pageHeightPx = (paper.heightMm / 25.4) * 96

  // Compute CSS padding for the editable page from the margin values.
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

  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const update = () => {
      const available = el.clientWidth - 32
      setScale(available > 0 ? Math.min(1, available / pageWidthPx) : 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pageWidthPx])

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const update = () => setContentHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Scale the editable sheet to fit the left pane.
  useEffect(() => {
    const el = editorPaneRef.current
    if (!el) return
    const update = () => {
      const available = el.clientWidth - 32
      setEditorScale(available > 0 ? Math.min(1, available / pageWidthPx) : 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pageWidthPx])

  useEffect(() => {
    const el = editorPageRef.current
    if (!el) return
    const update = () => setEditorContentHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
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

        {/* SectionKit Picker */}
        <SectionKitPicker
          selectedDesignId={designId}
          onSelectDesign={setDesignId}
        />

        <SpacingPanel
          spacing={spacing}
          onChange={setSpacing}
          onReset={resetSpacing}
          headingSpacingEnabled={spacingEnabled}
        />

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
        <div ref={editorPaneRef} className="editor-preview left-pane">
          <div
            style={{
              width: pageWidthPx * editorScale,
              height: Math.max(editorContentHeight, pageHeightPx) * editorScale,
              margin: '0 auto',
              position: 'relative',
            }}
          >
            <div
              ref={editorPageRef}
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
                transform: `scale(${editorScale})`,
                transformOrigin: 'top left',
              }}
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        <div ref={previewRef} className="editor-preview right-pane">
          <div className="pane-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activePaneTab === 'preview'}
              className={`pane-tab ${activePaneTab === 'preview' ? 'pane-tab-active' : ''}`}
              onClick={() => setActivePaneTab('preview')}
            >
              Preview
            </button>
            <button
              role="tab"
              aria-selected={activePaneTab === 'code'}
              className={`pane-tab ${activePaneTab === 'code' ? 'pane-tab-active' : ''}`}
              onClick={() => setActivePaneTab('code')}
            >
              Code
            </button>
          </div>

          {activePaneTab === 'preview' && (
            <div className="pane-content">
              {loading && <div className="compiling-indicator" aria-live="polite">Compiling…</div>}
              {dirty && !loading && !error && (
                <div className="unsaved-indicator" aria-live="polite">
                  Unsaved changes — press Ctrl+S to compile
                </div>
              )}
              {error && <div className="compile-error" role="alert">{error}</div>}
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
                  className="compiled-pages"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${paper.widthMm}mm`,
                    minHeight: `${paper.heightMm}mm`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  {svgBlobUrls.map((blobUrl, idx) => (
                    <img
                      key={idx}
                      src={blobUrl}
                      alt={`Page ${idx + 1}`}
                      className="compiled-page"
                      style={{
                        width: '100%',
                        height: 'auto',
                        display: 'block',
                        marginBottom: idx < svgBlobUrls.length - 1 ? '16px' : 0,
                      }}
                    />
                  ))}
                  {svgBlobUrls.length === 0 && !loading && !error && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                      Press Ctrl+S to compile
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePaneTab === 'code' && (
            <div className="pane-content">
              <pre className="editor-code">{code}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Tiptap
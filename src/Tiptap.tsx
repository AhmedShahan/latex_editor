import { useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import 'computer-modern/cmu-serif.css'
type DocType = 'article' | 'report' | 'book'

const HEADING_LABELS: Record<DocType, string[]> = {
  article: ['Section', 'Subsection', 'Subsubsection'],
  report: ['Chapter', 'Section', 'Subsection'],
  book: ['Chapter', 'Section', 'Subsection'],
}

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

const toLatex = (doc: JNode, docType: DocType) => {
  const body = (doc.content ?? [])
    .map((n) => renderBlock(n, docType))
    .filter(Boolean)
    .join('\n\n')
  return `\\documentclass{${docType}}\n\n\\begin{document}\n\n${body}\n\n\\end{document}`
}

const Tiptap = () => {
  const [docType, setDocType] = useState<DocType>('article')
  const [showGrid, setShowGrid] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: '<p>WELCOME TO LATEX EDITOR</p>',
  })

  const json = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? (editor.getJSON() as unknown as JNode) : null),
  })
  const code = json ? toLatex(json, docType) : ''

  return (
    <div style={{ textAlign: 'left', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
          <option value="article">Article</option>
          <option value="report">Report</option>
          <option value="book">Book</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          Show grid
        </label>
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

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, background: '#ddd', padding: 16 }}>
          <div
            style={{
              background: '#fff',
              ...(showGrid
                ? {
                    backgroundImage: `repeating-linear-gradient(0deg, #eee 0, #eee 1px, transparent 1px, transparent 20px), repeating-linear-gradient(90deg, #eee 0, #eee 1px, transparent 1px, transparent 20px)`,
                    backgroundSize: '20px 20px',
                  }
                : {}),
              color: '#000',
              fontFamily: '"CMU Serif", serif',
              width: '210mm',
              maxWidth: '100%',
              minHeight: '297mm',
              padding: '25mm',
              boxSizing: 'border-box',
              boxShadow: '0 0 6px rgba(0,0,0,0.3)',
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        <pre style={{ flex: 1, margin: 0, overflow: 'auto' }}>{code}</pre>
      </div>
    </div>
  )
}

export default Tiptap
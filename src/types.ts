export type DocType = 'article' | 'report' | 'book'

export const HEADING_LABELS: Record<DocType, string[]> = {
  article: ['Section', 'Subsection', 'Subsubsection'],
  report: ['Chapter', 'Section', 'Subsection'],
  book: ['Chapter', 'Section', 'Subsection'],
}

export type PaperSize = 'a4paper' | 'letterpaper' | 'legalpaper' | 'a5paper'
export const PAPER_SIZES: Record<PaperSize, { label: string; widthMm: number; heightMm: number }> = {
  a4paper: { label: 'A4 (210×297 mm)', widthMm: 210, heightMm: 297 },
  letterpaper: { label: 'Letter (215.9×279.4 mm)', widthMm: 215.9, heightMm: 279.4 },
  legalpaper: { label: 'Legal (215.9×355.6 mm)', widthMm: 215.9, heightMm: 355.6 },
  a5paper: { label: 'A5 (148×210 mm)', widthMm: 148, heightMm: 210 },
}
export const PAPER_ORDER: PaperSize[] = ['a4paper', 'letterpaper', 'legalpaper', 'a5paper']

export const FONT_SIZES = ['10pt', '11pt', '12pt'] as const
export type FontSize = (typeof FONT_SIZES)[number]

export const DEFAULT_MARGIN = '1in'
export const MARGIN_KEYS = ['top', 'bottom', 'left', 'right'] as const
export type MarginKey = (typeof MARGIN_KEYS)[number]
export type Margins = Record<MarginKey, string>
export type Geometry = { uniform: boolean; margin: string; margins: Margins }
export const MARGIN_LABELS: Record<MarginKey, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' }
export const DEFAULT_MARGINS: Margins = { top: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN, right: DEFAULT_MARGIN }
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDesigns, type Design, extractPreamble, buildDocument, SAMPLE_BODY } from './sectionkit'
import type { DocType, PaperSize, FontSize, Geometry } from './types'

interface SectionKitPickerProps {
  docType: DocType
  paper: PaperSize
  fontSize: FontSize
  geometry: Geometry
  selectedDesignId: string
  onSelectDesign: (designId: string) => void
}

const DEFAULT_DESIGN_ID = 'default'

/**
 * Lazy thumbnail cache: Map<designId, { blobUrl: string; revoked: boolean }>
 * Compiled on first open, memoized at module level.
 */
const thumbnailCache = new Map<string, { blobUrl: string; revoked: boolean }>()

/**
 * Build the full LaTeX document for a design's thumbnail.
 */
function buildThumbnailLatex(
  design: Design,
  docType: DocType,
  paper: PaperSize,
  fontSize: FontSize,
  geometry: Geometry
): string {
  const preamble = extractPreamble(design.raw)
  const geometryOptions = buildGeometryOptions(geometry)
  return buildDocument({
    docType,
    paper,
    fontSize,
    geometryOptions,
    preamble,
    body: SAMPLE_BODY,
  })
}

/**
 * Build geometry options string from Geometry object (mirrors Tiptap logic).
 */
function buildGeometryOptions(geometry: Geometry): string {
  const { uniform, margin, margins } = geometry
  const sanitize = (value: string) => value.replaceAll('[', '').replaceAll(']', '').replace(/[\r\n]/g, '').trim() || '1in'
  if (uniform) {
    return `margin=${sanitize(margin)}`
  }
  return [
    `top=${sanitize(margins.top)}`,
    `bottom=${sanitize(margins.bottom)}`,
    `left=${sanitize(margins.left)}`,
    `right=${sanitize(margins.right)}`,
  ].join(', ')
}

/**
 * Compile a thumbnail for a design if not already cached.
 */
async function ensureThumbnail(
  design: Design,
  docType: DocType,
  paper: PaperSize,
  fontSize: FontSize,
  geometry: Geometry
): Promise<string | null> {
  if (thumbnailCache.has(design.id)) {
    const cached = thumbnailCache.get(design.id)!
    if (!cached.revoked) return cached.blobUrl
  }

  const latex = buildThumbnailLatex(design, docType, paper, fontSize, geometry)

  try {
    const response = await fetch('/api/sectionkit/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    })

    if (!response.ok) return null

    const data = await response.json()
    if (data.error || !data.pages?.[0]) return null

    const svg = data.pages[0]
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const blobUrl = URL.createObjectURL(blob)
    thumbnailCache.set(design.id, { blobUrl, revoked: false })
    return blobUrl
  } catch {
    return null
  }
}

/**
 * SectionKit design picker: button + card grid with live thumbnails.
 */
export function SectionKitPicker({
  docType,
  paper,
  fontSize,
  geometry,
  selectedDesignId,
  onSelectDesign,
}: SectionKitPickerProps) {
  const [open, setOpen] = useState(false)
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [loadingThumbs, setLoadingThumbs] = useState<Set<string>>(new Set())
  const designs = useMemo(() => getDesigns(), [])
  const pickerRef = useRef<HTMLDivElement>(null)
  // Designs whose thumbnail compile failed; never retried automatically.
  const failedThumbs = useRef<Set<string>>(new Set())

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Load thumbnails lazily when picker opens
  useEffect(() => {
    if (!open) return
    const loadAll = async () => {
      for (const design of designs) {
        if (design.id === DEFAULT_DESIGN_ID) continue
        if (thumbnails.has(design.id) || loadingThumbs.has(design.id) || failedThumbs.current.has(design.id)) continue
        setLoadingThumbs((prev) => new Set(prev).add(design.id))
        const blobUrl = await ensureThumbnail(design, docType, paper, fontSize, geometry)
        if (blobUrl) {
          setThumbnails((prev) => new Map(prev).set(design.id, blobUrl))
        } else {
          failedThumbs.current.add(design.id)
        }
        setLoadingThumbs((prev) => {
          const next = new Set(prev)
          next.delete(design.id)
          return next
        })
      }
    }
    loadAll()
  }, [open, designs, docType, paper, fontSize, geometry, thumbnails, loadingThumbs])

  const handleSelect = (designId: string) => {
    onSelectDesign(designId)
    setOpen(false)
  }

  return (
    <div className="sectionkit-picker" ref={pickerRef}>
      <button
        type="button"
        className="sectionkit-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        SectionKit: {selectedDesignId === DEFAULT_DESIGN_ID ? 'Default' : getDesignByName(designs, selectedDesignId)?.name ?? selectedDesignId}
      </button>

      {open && (
        <div className="sectionkit-dropdown" role="menu">
          <div className="sectionkit-card" role="menuitem" onClick={() => handleSelect(DEFAULT_DESIGN_ID)}>
            <div className="sectionkit-card-thumb default-thumb" />
            <span className="sectionkit-card-name">Default</span>
            {selectedDesignId === DEFAULT_DESIGN_ID && <span className="sectionkit-check" aria-hidden>✓</span>}
          </div>
          {designs.map((design) => (
            <div
              key={design.id}
              className="sectionkit-card"
              role="menuitem"
              onClick={() => handleSelect(design.id)}
            >
              <div className="sectionkit-card-thumb">
                {loadingThumbs.has(design.id) && <span className="sectionkit-thumb-loading">…</span>}
                {thumbnails.has(design.id) && (
                  <img
                    src={thumbnails.get(design.id)!}
                    alt={`${design.name} preview`}
                    className="sectionkit-thumb-img"
                    loading="lazy"
                  />
                )}
                {!thumbnails.has(design.id) && !loadingThumbs.has(design.id) && (
                  <span className="sectionkit-thumb-placeholder">⟳</span>
                )}
              </div>
              <span className="sectionkit-card-name">{design.name}</span>
              {selectedDesignId === design.id && <span className="sectionkit-check" aria-hidden>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getDesignByName(designs: Design[], id: string): Design | undefined {
  return designs.find((d) => d.id === id)
}

// Cleanup on unmount (module-level)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const { blobUrl, revoked } of thumbnailCache.values()) {
      if (!revoked) URL.revokeObjectURL(blobUrl)
    }
    thumbnailCache.clear()
  })
}
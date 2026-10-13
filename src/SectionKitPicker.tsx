import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getDesigns } from './sectionkit'

const DEFAULT_DESIGN_ID = 'default'

/** Keep this in sync with the dropdown's outside margin in index.css. */
const VIEWPORT_MARGIN = 8

interface SectionKitPickerProps {
  selectedDesignId: string
  onSelectDesign: (designId: string) => void
}

/**
 * SectionKit design picker: button + card grid with static preview images.
 * No runtime compilation — previews are bundled SVGs generated at build time
 * by `scripts/generate-sectionkit-previews.mjs`.
 */
export function SectionKitPicker({
  selectedDesignId,
  onSelectDesign,
}: SectionKitPickerProps) {
  const [open, setOpen] = useState(false)
  const designs = useMemo(() => getDesigns(), [])
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  // The card grid is wide, so keep the dropdown inside the viewport instead of
  // letting it stick out of the right edge.
  useLayoutEffect(() => {
    if (!open) return
    const picker = pickerRef.current
    const trigger = triggerRef.current
    const dropdown = dropdownRef.current
    if (!picker || !trigger || !dropdown) return

    const place = () => {
      dropdown.style.left = '0px'
      const limit = document.documentElement.clientWidth - dropdown.offsetWidth - VIEWPORT_MARGIN
      const wanted = Math.min(trigger.getBoundingClientRect().left, Math.max(VIEWPORT_MARGIN, limit))
      dropdown.style.left = `${wanted - picker.getBoundingClientRect().left}px`
    }

    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const handleSelect = (designId: string) => {
    onSelectDesign(designId)
    setOpen(false)
  }

  const selectedDesign = designs.find((d) => d.id === selectedDesignId)

  return (
    <div className="sectionkit-picker" ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="sectionkit-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        SectionKit: {selectedDesignId === DEFAULT_DESIGN_ID ? 'Default' : selectedDesign?.name ?? selectedDesignId}
      </button>

      {open && (
        <div className="sectionkit-dropdown" role="menu" ref={dropdownRef}>
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
                {design.previewUrl ? (
                  <img
                    src={design.previewUrl}
                    alt={`${design.name} preview`}
                    className="sectionkit-thumb-img"
                  />
                ) : (
                  <span className="sectionkit-thumb-missing">—</span>
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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Spacing, SpacingTarget, TitleSpacing } from './types'
import { SPACING_TARGETS, SPACING_TARGET_LABELS, TITLE_SPACING_FIELDS } from './types'

/** Keep this in sync with the dropdown's outside margin in index.css. */
const VIEWPORT_MARGIN = 8
/** Amount added/removed by the +/− buttons. */
const STEP = 0.5

/** True when a value starts with a number we can nudge (e.g. `3.5ex`, `0pt`). */
const steppable = (value: string) => /^\s*-?\d*\.?\d+/.test(value)

/** The leading number of a value, or null when there is none. */
const numericValue = (value: string): number | null => {
  const match = value.match(/^\s*(-?\d*\.?\d+)/)
  return match ? parseFloat(match[1]) : null
}

/**
 * Add `delta` to the leading number of `value`, keeping the unit and any
 * trailing stretch/shrink (e.g. `3.5ex plus 1ex minus .2ex` → `4ex plus …`).
 */
const stepValue = (value: string, delta: number): string => {
  const match = value.match(/^(\s*)(-?\d*\.?\d+)([\s\S]*)$/)
  if (!match) return value
  const next = Math.max(0, Math.round((parseFloat(match[2]) + delta) * 10000) / 10000)
  return `${match[1]}${next}${match[3]}`
}

interface StepperFieldProps {
  label: string
  value: string
  ariaLabel: string
  onChange: (value: string) => void
}

/** One labelled input with −/+ buttons and free typing. */
function StepperField({ label, value, ariaLabel, onChange }: StepperFieldProps) {
  const canStep = steppable(value)
  const numeric = numericValue(value)
  const atFloor = numeric !== null && numeric <= 0
  return (
    <label className="spacing-field">
      <span className="spacing-label">{label}</span>
      <div className="spacing-input-wrapper">
        <button
          type="button"
          className="spacing-decrement"
          onClick={() => onChange(stepValue(value, -STEP))}
          disabled={!canStep || atFloor}
          aria-label={`Decrease ${ariaLabel}`}
          title="Decrease"
        >
          −
        </button>
        <input
          className="spacing-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className="spacing-increment"
          onClick={() => onChange(stepValue(value, STEP))}
          disabled={!canStep}
          aria-label={`Increase ${ariaLabel}`}
          title="Increase"
        >
          +
        </button>
      </div>
    </label>
  )
}

interface SpacingPanelProps {
  spacing: Spacing
  onChange: (spacing: Spacing) => void
  onReset: () => void
  /** False when the selected design has no `titlesec`, so heading spacing is not emitted. */
  headingSpacingEnabled: boolean
}

/**
 * Spacing popup: tunes the three `\titlespacing*` arguments (left / above /
 * below) of each heading level plus `\parskip`/`\parindent`. Each field can be
 * typed into or nudged with −/+ buttons. Same shell as SectionKitPicker —
 * button, dropdown, outside-click close, viewport clamp.
 */
export function SpacingPanel({
  spacing,
  onChange,
  onReset,
  headingSpacingEnabled,
}: SpacingPanelProps) {
  const [open, setOpen] = useState(false)
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

  // Keep the panel inside the viewport instead of letting it stick out of the edge.
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

  const setTitleField = (target: SpacingTarget, field: keyof TitleSpacing, value: string) => {
    onChange({ ...spacing, [target]: { ...spacing[target], [field]: value } })
  }

  const setParagraphField = (field: 'parskip' | 'parindent', value: string) => {
    onChange({ ...spacing, [field]: value })
  }

  return (
    <div className="spacing-picker" ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="spacing-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Spacing
      </button>

      {open && (
        <div className="spacing-dropdown" ref={dropdownRef}>
          {!headingSpacingEnabled && (
            <div className="spacing-note">
              Heading spacing needs a SectionKit design that uses <code>titlesec</code>. Paragraph
              spacing still applies; heading values are kept but not emitted.
            </div>
          )}

          <div className="spacing-help">
            <strong>Left</strong> = indent, <strong>Above</strong> = gap above the heading,{' '}
            <strong>Below</strong> = gap below it.
          </div>

          {SPACING_TARGETS.map((target) => (
            <div className="spacing-group" key={target}>
              <div className="spacing-group-title">{SPACING_TARGET_LABELS[target]}</div>
              <div className="spacing-row">
                {TITLE_SPACING_FIELDS.map((field) => (
                  <StepperField
                    key={field.key}
                    label={field.label}
                    value={spacing[target][field.key]}
                    ariaLabel={`${SPACING_TARGET_LABELS[target]} ${field.label}`}
                    onChange={(value) => setTitleField(target, field.key, value)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="spacing-group">
            <div className="spacing-group-title">Paragraph</div>
            <div className="spacing-row">
              <StepperField
                label="Gap"
                value={spacing.parskip}
                ariaLabel="Paragraph gap (parskip)"
                onChange={(value) => setParagraphField('parskip', value)}
              />
              <StepperField
                label="First-line indent"
                value={spacing.parindent}
                ariaLabel="First-line indent (parindent)"
                onChange={(value) => setParagraphField('parindent', value)}
              />
            </div>
          </div>

          <button type="button" className="spacing-reset" onClick={onReset}>
            Reset to design defaults
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState, type CSSProperties } from "react"

export function Dropdown<T extends string>(props: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  const { label, value, options, onChange } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="dd" ref={ref}>
      <button type="button" className={"dd-trigger" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label">{label}</span>
        <span className="value">
          {value} <span className="caret">▾</span>
        </span>
      </button>
      {open && (
        <ul className="dd-list" role="listbox">
          {options.map((o) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={o === value}
                className={o === value ? "selected" : ""}
                onClick={() => {
                  onChange(o)
                  setOpen(false)
                }}
              >
                <span className="dot">{o === value ? "●" : "○"}</span>
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const { label, value, min, max, step, format, onChange } = props
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="slider">
      <span className="slider-head">
        <span className="label">{label}</span>
        <span className="value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

const HEX_RE = /^#?([0-9a-f]{6})$/i

export function ColorRow(props: { value: string; onChange: (hex: string) => void }) {
  const { value, onChange } = props
  const [text, setText] = useState(value.toUpperCase())
  useEffect(() => setText(value.toUpperCase()), [value])

  const commit = () => {
    const m = HEX_RE.exec(text.trim())
    if (m) onChange("#" + m[1].toUpperCase())
    else setText(value.toUpperCase())
  }

  return (
    <div className="color-row">
      <span className="label">Pixel</span>
      <span className="color-right">
        <input
          className="hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value)
            const m = HEX_RE.exec(e.target.value.trim())
            if (m) onChange("#" + m[1].toUpperCase())
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          }}
        />
        <label className="swatch" style={{ background: value }}>
          <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
      </span>
    </div>
  )
}

export function Segmented<T extends string>(props: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  const { label, value, options, onChange } = props
  return (
    <div className="seg-row">
      <span className="label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={o === value ? "active" : ""}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

import { useRef, type ReactNode } from "react"
import { BLENDS, COLOR_MODES, COVERAGES, MOTIONS, SHAPES, type PixelSettings } from "../engine/pixelFilter"
import { PRESET_NAMES, type PresetName } from "../presets"
import { ColorRow, Dropdown, Segmented, Slider } from "./Controls"

export type FitMode = "Fit" | "Fill"
const FIT_MODES: FitMode[] = ["Fit", "Fill"]

const int = (v: number) => String(Math.round(v))
const two = (v: number) => v.toFixed(2)
const px = (v: number) => `${Math.round(v)}PX`
const times = (v: number) => `${v.toFixed(2)}X`

function Section(props: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">
        <span className="section-index">{props.index}</span>
        {props.title}
      </h2>
      <div className="section-body">{props.children}</div>
    </section>
  )
}

export function Panel(props: {
  settings: PixelSettings
  preset: PresetName
  collapsed: boolean
  copied: boolean
  fileName: string
  fit: FitMode
  onFit: (f: FitMode) => void
  onToggle: () => void
  onChange: (patch: Partial<PixelSettings>) => void
  onPreset: (p: PresetName) => void
  onFile: (f: File) => void
  onExportPng: () => void
  onCopyFramer: () => void
}) {
  const { settings: s, preset, collapsed, copied, fileName, fit, onFit, onToggle, onChange, onPreset, onFile, onExportPng, onCopyFramer } = props
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <aside className={"panel" + (collapsed ? " collapsed" : "")}>
      <header className="panel-head">
        <span className="logo" />
        <span className="title">Pixel Filter</span>
        <button
          type="button"
          className="toggle"
          onClick={onToggle}
          aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          title={collapsed ? "Expand (H)" : "Collapse (H)"}
        >
          ▾
        </button>
      </header>

      <div className="panel-content">
        <div className="panel-scroll">
          <Section index="01" title="Image">
            <button type="button" className="pill" onClick={() => fileRef.current?.click()}>
              ↑ Upload Image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onFile(f)
                e.target.value = ""
              }}
            />
            <p className="hint" title={fileName}>
              {fileName}
            </p>
            <Segmented label="Scale" value={fit} options={FIT_MODES} onChange={onFit} />
            <Slider label="Blur" value={s.blur} min={0} max={40} step={1} format={px} onChange={(v) => onChange({ blur: v })} />
          </Section>

          <Section index="02" title="Preset">
            <Dropdown label="Style" value={preset} options={PRESET_NAMES} onChange={onPreset} />
          </Section>

          <Section index="03" title="Pattern">
            <Dropdown label="Shape" value={s.shape} options={SHAPES} onChange={(v) => onChange({ shape: v })} />
            <Slider label="Pixel Size" value={s.pixelSize} min={4} max={48} step={1} format={int} onChange={(v) => onChange({ pixelSize: v })} />
            <Slider label="Variation" value={s.variation} min={0} max={1} step={0.01} format={two} onChange={(v) => onChange({ variation: v })} />
            <Slider label="Fill" value={s.fill} min={0.2} max={1.4} step={0.01} format={two} onChange={(v) => onChange({ fill: v })} />
          </Section>

          <Section index="04" title="Tone">
            <Dropdown label="Coverage" value={s.coverage} options={COVERAGES} onChange={(v) => onChange({ coverage: v })} />
            <Slider label="Threshold" value={s.threshold} min={0} max={1} step={0.01} format={two} onChange={(v) => onChange({ threshold: v })} />
          </Section>

          <Section index="05" title="Color">
            <Dropdown label="Color" value={s.color} options={COLOR_MODES} onChange={(v) => onChange({ color: v })} />
            {s.color === "Custom" && <ColorRow value={s.pixelColor} onChange={(v) => onChange({ pixelColor: v })} />}
            <Dropdown label="Blend" value={s.blend} options={BLENDS} onChange={(v) => onChange({ blend: v })} />
          </Section>

          <Section index="06" title="Motion">
            <Dropdown label="Motion" value={s.motion} options={MOTIONS} onChange={(v) => onChange({ motion: v })} />
            <Slider label="Speed" value={s.speed} min={0.1} max={3} step={0.05} format={times} onChange={(v) => onChange({ speed: v })} />
          </Section>
        </div>

        <footer className="panel-foot">
          <h2 className="section-title">
            <span className="section-index">07</span>
            Export
          </h2>
          <div className="actions">
            <button type="button" className="pill solid" onClick={onExportPng} title="Export PNG (E)">
              ↓ PNG
            </button>
            <button type="button" className="pill" onClick={onCopyFramer}>
              {copied ? "Copied ✓" : "⧉ Framer"}
            </button>
          </div>
        </footer>
      </div>
    </aside>
  )
}

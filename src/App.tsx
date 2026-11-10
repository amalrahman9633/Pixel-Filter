import { useCallback, useEffect, useRef, useState } from "react"
import { BLEND_CSS, PixelFilterRenderer, type PixelSettings } from "./engine/pixelFilter"
import type { FitMode } from "./components/Panel"
import { applyPreset, PRESETS, type PresetName } from "./presets"
import { Panel } from "./components/Panel"
import { buildFramerSnippet } from "./framer/buildSnippet"

const DEFAULT_IMAGE = `${import.meta.env.BASE_URL}default.png`
const MOBILE_QUERY = "(max-width: 519px)"

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

function initialSettings(): PixelSettings {
  const s = { ...PRESETS.Grid, pixelColor: "#9BE7D8" } as PixelSettings
  if (prefersReducedMotion()) s.motion = "None"
  return s
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [settings, setSettings] = useState<PixelSettings>(initialSettings)
  const [preset, setPreset] = useState<PresetName>("Grid")
  const [src, setSrc] = useState(DEFAULT_IMAGE)
  const [fileName, setFileName] = useState("default.png")
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fit, setFit] = useState<FitMode>("Fit")
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const photoRef = useRef<HTMLCanvasElement>(null)
  const blockRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<PixelFilterRenderer | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const presetRef = useRef(preset)
  presetRef.current = preset

  // Renderer lifecycle.
  useEffect(() => {
    const r = new PixelFilterRenderer(blockRef.current!, photoRef.current, settingsRef.current)
    rendererRef.current = r
    if (import.meta.env.DEV) (window as unknown as { __pf: PixelFilterRenderer }).__pf = r
    const img = imgRef.current
    if (img?.complete && img.naturalWidth) {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      r.setImage(img)
    }
    return () => {
      r.destroy()
      rendererRef.current = null
    }
  }, [])

  // Workspace size (inside its padding).
  useEffect(() => {
    const stage = stageRef.current!
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setAvail({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  // Canvas frame: Fit = the whole image (contain), Fill = the whole workspace (cover crop).
  let frameW = avail.w
  let frameH = avail.h
  if (fit === "Fit" && natural && avail.w > 0 && avail.h > 0) {
    const k = Math.min(avail.w / natural.w, avail.h / natural.h)
    frameW = Math.max(1, Math.round(natural.w * k))
    frameH = Math.max(1, Math.round(natural.h * k))
  }

  useEffect(() => {
    if (frameW > 0 && frameH > 0) rendererRef.current?.setSize(frameW, frameH)
  }, [frameW, frameH])

  useEffect(() => {
    rendererRef.current?.setSettings(settings)
  }, [settings])

  // New src: hand the image to the renderer once it has loaded. Checks
  // `complete` as well as listening, so a cached image that finished loading
  // before this effect ran is never missed. Revokes old blob URLs.
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const ready = () => {
      if (!img.naturalWidth) return
      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      rendererRef.current?.setImage(img)
    }
    if (img.complete && img.naturalWidth) ready()
    else rendererRef.current?.setImage(null)
    img.addEventListener("load", ready)
    return () => {
      img.removeEventListener("load", ready)
      if (src.startsWith("blob:")) URL.revokeObjectURL(src)
    }
  }, [src])

  const change = useCallback((patch: Partial<PixelSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setPreset("Custom")
  }, [])

  const choosePreset = useCallback((p: PresetName) => {
    setPreset(p)
    if (p !== "Custom") setSettings((s) => applyPreset(p, s))
  }, [])

  const loadFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) return
    setSrc(URL.createObjectURL(f))
    setFileName(f.name)
  }, [])

  const toastTimer = useRef(0)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  const exportPng = useCallback(() => {
    const canvas = rendererRef.current?.renderExport()
    if (!canvas) return
    try {
      canvas.toBlob((blob) => {
        if (!blob) return showToast("Export failed.")
        download(blob, `pixel-filter-${presetRef.current.toLowerCase()}-${Date.now()}.png`)
      }, "image/png")
    } catch {
      showToast("Export failed: this image can't be read (cross-origin).")
    }
  }, [showToast])

  const copyFramer = useCallback(async () => {
    const code = buildFramerSnippet(settingsRef.current)
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
      showToast("Copied! Paste into Framer → Assets → Code, then set the image in the right panel.")
    } catch {
      download(new Blob([code], { type: "text/plain" }), "PixelFilter.tsx")
      showToast("Clipboard unavailable, so PixelFilter.tsx was downloaded instead.")
    }
  }, [showToast])

  // Keyboard: H toggles panel, E exports PNG.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return
      const k = e.key.toLowerCase()
      if (k === "h") setCollapsed((c) => !c)
      else if (k === "e") exportPng()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [exportPng])

  const blurred = settings.blur > 0

  return (
    <div className={"app" + (collapsed ? " sidebar-collapsed" : "")}>
      <div
        ref={stageRef}
        className={"stage" + (dragging ? " dragging" : "")}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) loadFile(f)
        }}
      >
        <div className="frame" style={{ width: frameW || "100%", height: frameH || "100%" }}>
          <img
            ref={imgRef}
            className="layer photo"
            src={src}
            alt=""
            draggable={false}
            style={{ visibility: blurred ? "hidden" : "visible" }}
          />
          <canvas ref={photoRef} className="layer" style={{ visibility: blurred ? "visible" : "hidden" }} />
          <canvas ref={blockRef} className="layer blocks" style={{ mixBlendMode: BLEND_CSS[settings.blend] as any }} />
        </div>
        {dragging && <div className="drop-hint">Drop image</div>}
      </div>

      <Panel
        settings={settings}
        preset={preset}
        collapsed={collapsed}
        copied={copied}
        fileName={fileName}
        fit={fit}
        onFit={setFit}
        onToggle={() => setCollapsed((c) => !c)}
        onChange={change}
        onPreset={choosePreset}
        onFile={loadFile}
        onExportPng={exportPng}
        onCopyFramer={copyFramer}
      />

      <div className={"toast" + (toast ? " show" : "")} role="status">
        {toast}
      </div>
    </div>
  )
}

/*
 * Pixel Filter engine.
 *
 * Self-contained: NO imports. This file is embedded verbatim (minus `export`
 * keywords) into the Framer code component export, so keep it dependency-free
 * and never touch `window`/`document` at module top level (SSR safety).
 */

// ─── Types & option lists ────────────────────────────────────────────────────

export type Shape = "Square" | "Rounded" | "Circle" | "Diamond" | "Ring" | "Cross" | "Triangle" | "Hexagon"
export type Coverage = "Full Range" | "Highlights" | "Midtones" | "Shadows"
export type ColorMode = "White" | "Source" | "Custom"
export type Blend = "Normal" | "Screen" | "Add" | "Multiply" | "Overlay"
export type Motion = "None" | "Shimmer" | "Pulse" | "Wave" | "Scan" | "Rain" | "Sparkle" | "Flicker"

export interface PixelSettings {
  shape: Shape
  pixelSize: number
  variation: number
  fill: number
  blur: number
  coverage: Coverage
  threshold: number
  color: ColorMode
  pixelColor: string
  blend: Blend
  motion: Motion
  speed: number
}

export const SHAPES: Shape[] = ["Square", "Rounded", "Circle", "Diamond", "Ring", "Cross", "Triangle", "Hexagon"]
export const COVERAGES: Coverage[] = ["Full Range", "Highlights", "Midtones", "Shadows"]
export const COLOR_MODES: ColorMode[] = ["White", "Source", "Custom"]
export const BLENDS: Blend[] = ["Normal", "Screen", "Add", "Multiply", "Overlay"]
export const MOTIONS: Motion[] = ["None", "Shimmer", "Pulse", "Wave", "Scan", "Rain", "Sparkle", "Flicker"]

/** CSS mix-blend-mode for the on-screen block canvas. */
export const BLEND_CSS: Record<Blend, string> = {
  Normal: "normal",
  Screen: "screen",
  Add: "plus-lighter",
  Multiply: "multiply",
  Overlay: "overlay",
}

/** Canvas composite op used when flattening for PNG export. */
export const BLEND_COMPOSITE: Record<Blend, GlobalCompositeOperation> = {
  Normal: "source-over",
  Screen: "screen",
  Add: "lighter",
  Multiply: "multiply",
  Overlay: "overlay",
}

// ─── Small math helpers ──────────────────────────────────────────────────────

const TAU = Math.PI * 2

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function fract(x: number): number {
  return x - Math.floor(x)
}

/** Integer hash of two ints → [0, 1). */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push((i < 16 ? "0" : "") + i.toString(16))

// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Cover-fit rect of an iw×ih image inside a W×H frame, centred. Same maths as CSS object-fit: cover. */
export function coverRect(iw: number, ih: number, W: number, H: number): Rect {
  const scale = Math.max(W / iw, H / ih)
  const w = iw * scale
  const h = ih * scale
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

// ─── Sampling ────────────────────────────────────────────────────────────────

interface Level {
  src: CanvasImageSource
  w: number
  h: number
}

/** Mip-style pyramid so the final downscale is ≤2× and therefore area-averaged. */
function buildPyramid(el: CanvasImageSource, w: number, h: number): Level[] {
  const levels: Level[] = [{ src: el, w, h }]
  let src: CanvasImageSource = el
  let cw = w
  let ch = h
  while (cw > 32 && ch > 32) {
    const nw = Math.max(1, Math.floor(cw / 2))
    const nh = Math.max(1, Math.floor(ch / 2))
    const c = makeCanvas(nw, nh)
    const x = c.getContext("2d")!
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = "high"
    x.drawImage(src, 0, 0, cw, ch, 0, 0, nw, nh)
    levels.push({ src: c, w: nw, h: nh })
    src = c
    cw = nw
    ch = nh
  }
  return levels
}

export interface Grid {
  cols: number
  rows: number
  cell: number
  /** Auto-levelled luminance per cell, 0–1. */
  ln: Float32Array
  /** Stable random seed per cell, 0–1. */
  seed: Float32Array
  /** Stable random seed per column (Rain). */
  colSeed: Float32Array
  /** Cell average colour as #rrggbb. */
  hex: string[]
  /** cols×rows opaque canvas of cell colours (used as a colour mask). */
  colorCanvas: HTMLCanvasElement
}

function sampleGrid(levels: Level[], W: number, H: number, cell: number): Grid | null {
  if (!levels.length || W < 1 || H < 1 || cell < 1) return null
  const base = levels[0]
  const rect = coverRect(base.w, base.h, W, H)
  const cols = Math.ceil(W / cell)
  const rows = Math.ceil(H / cell)

  // Smallest pyramid level that still has ≥1 source pixel per cell.
  let lvl = levels[0]
  for (const L of levels) {
    if ((cell * L.w) / rect.w >= 1) lvl = L
    else break
  }

  const c = makeCanvas(cols, rows)
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(lvl.src, 0, 0, lvl.w, lvl.h, rect.x / cell, rect.y / cell, rect.w / cell, rect.h / cell)

  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, cols, rows)
  } catch {
    return null // CORS-tainted: no blocks, photo shows untouched
  }
  const data = img.data
  const n = cols * rows
  const lum = new Float32Array(n)
  const seed = new Float32Array(n)
  const hex: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    data[i * 4 + 3] = 255
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    hex[i] = "#" + HEX[r] + HEX[g] + HEX[b]
    seed[i] = hash2(i % cols, (i / cols) | 0)
  }
  ctx.putImageData(img, 0, 0)

  // Auto-levels: remap 2nd–98th percentile to 0–1.
  const sorted = lum.slice().sort()
  const p2 = sorted[Math.floor(0.02 * (n - 1))]
  const p98 = sorted[Math.floor(0.98 * (n - 1))]
  const range = p98 - p2
  const ln = new Float32Array(n)
  for (let i = 0; i < n; i++) ln[i] = range > 1e-4 ? clamp01((lum[i] - p2) / range) : lum[i]

  const colSeed = new Float32Array(cols)
  for (let x = 0; x < cols; x++) colSeed[x] = hash2(x, 7919)

  return { cols, rows, cell, ln, seed, colSeed, hex, colorCanvas: c }
}

// ─── Per-cell static size/alpha (before motion) ──────────────────────────────

function coverageWeight(ln: number, coverage: Coverage, threshold: number): number {
  const s = 0.08
  switch (coverage) {
    case "Full Range":
      return 1
    case "Highlights":
      return smoothstep(threshold - s, threshold + s, ln)
    case "Shadows":
      return 1 - smoothstep(threshold - s, threshold + s, ln)
    case "Midtones": {
      const hw = 0.05 + threshold * 0.45
      return 1 - smoothstep(hw - s, hw + s, Math.abs(ln - 0.5))
    }
  }
}

interface Base {
  key: string
  size: Float32Array
  alpha: Float32Array
}

const baseCache = new WeakMap<Grid, Base>()

function getBase(grid: Grid, s: PixelSettings): Base {
  const key = `${s.variation}|${s.fill}|${s.coverage}|${s.threshold}`
  const hit = baseCache.get(grid)
  if (hit && hit.key === key) return hit
  const n = grid.ln.length
  const size = new Float32Array(n)
  const alpha = new Float32Array(n)
  const k = grid.cell * s.fill
  for (let i = 0; i < n; i++) {
    const L = grid.ln[i]
    const tone = 1 + (L - 1) * s.variation // mix(1, Ln, variation)
    const cw = coverageWeight(L, s.coverage, s.threshold)
    size[i] = k * tone * cw
    alpha[i] = cw
  }
  const b = { key, size, alpha }
  baseCache.set(grid, b)
  return b
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Appends one shape (centred at cx,cy, bounding box `s`) to a path. Uses
 * nonzero winding throughout (Ring's hole is wound in reverse).
 */
function addShape(p: CanvasPath, shape: Shape, cx: number, cy: number, s: number): void {
  const h = s / 2
  switch (shape) {
    case "Square":
      p.rect(cx - h, cy - h, s, s)
      return
    case "Rounded": {
      // cubic-Bézier quarter circles (much cheaper to rasterise than arcTo)
      const r = s * 0.25
      const k = r * 0.4477
      const x = cx - h
      const y = cy - h
      const x2 = x + s
      const y2 = y + s
      p.moveTo(x + r, y)
      p.lineTo(x2 - r, y)
      p.bezierCurveTo(x2 - k, y, x2, y + k, x2, y + r)
      p.lineTo(x2, y2 - r)
      p.bezierCurveTo(x2, y2 - k, x2 - k, y2, x2 - r, y2)
      p.lineTo(x + r, y2)
      p.bezierCurveTo(x + k, y2, x, y2 - k, x, y2 - r)
      p.lineTo(x, y + r)
      p.bezierCurveTo(x, y + k, x + k, y, x + r, y)
      p.closePath()
      return
    }
    case "Circle":
      p.moveTo(cx + h, cy)
      p.arc(cx, cy, h, 0, TAU)
      p.closePath()
      return
    case "Diamond":
      p.moveTo(cx, cy - h)
      p.lineTo(cx + h, cy)
      p.lineTo(cx, cy + h)
      p.lineTo(cx - h, cy)
      p.closePath()
      return
    case "Ring": {
      const ri = h * 0.55
      p.moveTo(cx + h, cy)
      p.arc(cx, cy, h, 0, TAU, false)
      p.closePath()
      p.moveTo(cx + ri, cy)
      p.arc(cx, cy, ri, TAU, 0, true)
      p.closePath()
      return
    }
    case "Cross": {
      const a = s * 0.15 // half of 30% arm thickness
      p.moveTo(cx - a, cy - h)
      p.lineTo(cx + a, cy - h)
      p.lineTo(cx + a, cy - a)
      p.lineTo(cx + h, cy - a)
      p.lineTo(cx + h, cy + a)
      p.lineTo(cx + a, cy + a)
      p.lineTo(cx + a, cy + h)
      p.lineTo(cx - a, cy + h)
      p.lineTo(cx - a, cy + a)
      p.lineTo(cx - h, cy + a)
      p.lineTo(cx - h, cy - a)
      p.lineTo(cx - a, cy - a)
      p.closePath()
      return
    }
    case "Triangle": {
      const th = s * 0.8660254 // equilateral height for side s
      const top = cy - th / 2
      p.moveTo(cx, top)
      p.lineTo(cx + h, top + th)
      p.lineTo(cx - h, top + th)
      p.closePath()
      return
    }
    case "Hexagon": {
      // pointy-top, circumradius h (fits the box vertically)
      const w = h * 0.8660254
      p.moveTo(cx, cy - h)
      p.lineTo(cx + w, cy - h / 2)
      p.lineTo(cx + w, cy + h / 2)
      p.lineTo(cx, cy + h)
      p.lineTo(cx - w, cy + h / 2)
      p.lineTo(cx - w, cy - h / 2)
      p.closePath()
      return
    }
  }
}

// ─── Block drawing ───────────────────────────────────────────────────────────

const ALPHA_BUCKETS = 32

/**
 * Shapes per beginPath/fill. Rasterising one path of many curved/polygon
 * subpaths gets super-linearly slow, so complex shapes use smaller chunks.
 * (Measured: 16k cells at 2560×1600 all land around 4–12 ms.)
 */
const PATH_CHUNK: Record<Shape, number> = {
  Square: 64,
  Rounded: 8,
  Circle: 64,
  Diamond: 16,
  Ring: 4,
  Cross: 16,
  Triangle: 16,
  Hexagon: 16,
}

interface Scratch {
  cap: number
  count: number
  x: Float32Array
  y: Float32Array
  size: Float32Array
  bucket: Uint8Array
  order: Uint32Array
  perBucket: Uint32Array
  offset: Uint32Array
}

let scratch: Scratch | null = null

/** Reusable per-frame buffers (no allocation per frame). */
function getScratch(n: number): Scratch {
  if (!scratch || scratch.cap < n) {
    scratch = {
      cap: n,
      count: 0,
      x: new Float32Array(n),
      y: new Float32Array(n),
      size: new Float32Array(n),
      bucket: new Uint8Array(n),
      order: new Uint32Array(n),
      perBucket: new Uint32Array(ALPHA_BUCKETS + 1),
      offset: new Uint32Array(ALPHA_BUCKETS + 2),
    }
  }
  scratch.count = 0
  scratch.perBucket.fill(0)
  return scratch
}

/**
 * Draws the blocks for time `t` into `ctx`, in stage (CSS pixel) coordinates.
 * The caller sets the base transform (dpr or export scale) and clears.
 * `ctx` must be a blocks-only canvas (Source colour may use it as a mask).
 */
function drawBlocks(ctx: CanvasRenderingContext2D, grid: Grid, s: PixelSettings, t: number): void {
  const { cols, rows, cell } = grid
  const base = getBase(grid, s)
  const m = s.motion
  const shape = s.shape
  const half = cell / 2

  const pulse = 0.85 + 0.15 * Math.sin(TAU * t)
  const scanPos = fract(t * 0.5)
  const sparkleT = t * 2
  const flickT = Math.floor(t * 8)

  const maxScale = m === "Shimmer" ? 1.12 : 1
  const isSquare = shape === "Square"
  const source = s.color === "Source"
  // Source colour: draw every block white, then tint with the per-cell colour
  // grid (source-in). Exact while blocks stay inside their own cell; for
  // overflowing (fill > 1) squares we fill per cell instead, which is cheap.
  // Overflowing non-square shapes still use the mask: the overflow takes the
  // neighbouring cell's colour, which reads the same at these sizes.
  const perCell = source && isSquare && s.fill * maxScale > 1.0001
  const useMask = source && !perCell
  const color = s.color === "Custom" ? s.pixelColor : "#ffffff"

  // Non-square shapes: collected per alpha bucket, then filled in small path
  // chunks (one huge path of polygons rasterises super-linearly slowly).
  const n = cols * rows
  const sc = isSquare ? null : getScratch(n)

  if (!perCell) ctx.fillStyle = color

  for (let row = 0; row < rows; row++) {
    const yN = row / rows
    const cy = row * cell + half
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      let a = base.alpha[i]
      if (a < 0.01) continue
      let size = base.size[i]
      if (size * maxScale < 0.5) continue
      const h = grid.seed[i]

      switch (m) {
        case "Shimmer":
          size *= 1 + 0.12 * Math.sin(TAU * (t * 1.5 + h))
          a *= 0.85 + 0.15 * Math.sin(TAU * (t * 2 + h))
          break
        case "Pulse":
          size *= pulse
          break
        case "Wave":
          size *= 0.8 + 0.2 * Math.sin(TAU * (t - (col + row) * 0.04))
          break
        case "Scan": {
          const d = (yN - scanPos) * 8
          a *= 0.35 + 0.65 * Math.exp(-d * d)
          break
        }
        case "Rain": {
          const pos = fract(t * 0.6 + grid.colSeed[col])
          a *= yN <= pos ? 0.3 + 0.7 * Math.max(0, 1 - (pos - yN) * 6) : 0.3
          break
        }
        case "Sparkle": {
          // Each cell re-rolls every 0.5 t; ~4% get picked and flare over 0.4 t.
          const u = sparkleT + h
          const ep = Math.floor(u)
          const ph = u - ep
          let f = 0
          if (ph < 0.8 && hash2(i, ep) < 0.04) f = Math.sin((Math.PI * ph) / 0.8)
          a *= 0.55 + 0.45 * f
          break
        }
        case "Flicker":
          a *= hash2(i, flickT) > 0.15 ? 1 : 0.2
          break
      }

      if (size < 0.5 || a < 0.01) continue
      const cx = col * cell + half

      if (isSquare) {
        ctx.globalAlpha = a
        if (perCell) ctx.fillStyle = grid.hex[i]
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size)
      } else {
        let b = Math.round(a * ALPHA_BUCKETS)
        if (b <= 0) continue
        if (b > ALPHA_BUCKETS) b = ALPHA_BUCKETS
        const k = sc!.count++
        sc!.x[k] = cx
        sc!.y[k] = cy
        sc!.size[k] = size
        sc!.bucket[k] = b
        sc!.perBucket[b]++
      }
    }
  }

  if (sc && sc.count) {
    // counting sort by alpha bucket
    const off = sc.offset
    off[0] = 0
    for (let b = 1; b <= ALPHA_BUCKETS + 1; b++) off[b] = off[b - 1] + sc.perBucket[b - 1]
    for (let k = 0; k < sc.count; k++) sc.order[off[sc.bucket[k]]++] = k
    const chunk = PATH_CHUNK[shape]
    let pos = 0
    for (let b = 0; b <= ALPHA_BUCKETS; b++) {
      const cnt = sc.perBucket[b]
      if (!cnt) continue
      ctx.globalAlpha = b / ALPHA_BUCKETS
      const stop = pos + cnt
      while (pos < stop) {
        const chunkEnd = Math.min(stop, pos + chunk)
        ctx.beginPath()
        for (; pos < chunkEnd; pos++) {
          const k = sc.order[pos]
          addShape(ctx, shape, sc.x[k], sc.y[k], sc.size[k])
        }
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

  if (useMask) {
    ctx.save()
    ctx.globalCompositeOperation = "source-in"
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(grid.colorCanvas, 0, 0, cols, rows, 0, 0, cols * cell, rows * cell)
    ctx.restore()
  }
}

// ─── Photo layer (with edge-clamped blur) ────────────────────────────────────

let filterSupport: boolean | null = null
function supportsCtxFilter(): boolean {
  if (filterSupport === null) {
    const ctx = makeCanvas(1, 1).getContext("2d") as CanvasRenderingContext2D & { filter?: string }
    filterSupport = typeof ctx.filter === "string"
  }
  return filterSupport
}

function boxPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, horiz: boolean) {
  const len = horiz ? w : h
  const lines = horiz ? h : w
  const step = horiz ? 4 : w * 4
  const norm = 1 / (2 * r + 1)
  const last = len - 1
  for (let l = 0; l < lines; l++) {
    const start = horiz ? l * w * 4 : l * 4
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[start + Math.min(last, Math.max(0, k)) * step + c]
      for (let x = 0; x < len; x++) {
        dst[start + x * step + c] = sum * norm
        sum += src[start + Math.min(last, x + r + 1) * step + c] - src[start + Math.max(0, x - r) * step + c]
      }
    }
  }
}

/** Approximate gaussian (3 box passes) for browsers without ctx.filter. */
function softwareBlur(data: Uint8ClampedArray, w: number, h: number, sigma: number) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2))
  const tmp = new Uint8ClampedArray(data.length)
  for (let i = 0; i < 3; i++) {
    boxPass(data, tmp, w, h, r, true)
    boxPass(tmp, data, w, h, r, false)
  }
}

/**
 * Paints the image cover-fit into `out` (its full backing size). If blur > 0
 * (in `out` pixels), the image is padded with edge-clamped pixels before
 * blurring so there is no zoom and no faded edges.
 */
function drawPhoto(out: HTMLCanvasElement, el: CanvasImageSource, iw: number, ih: number, blur: number) {
  const W = out.width
  const H = out.height
  const ctx = out.getContext("2d")!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  const r = coverRect(iw, ih, W, H)
  if (blur <= 0) {
    ctx.drawImage(el, r.x, r.y, r.w, r.h)
    return
  }

  const sharp = makeCanvas(W, H)
  const sc = sharp.getContext("2d")!
  sc.imageSmoothingQuality = "high"
  sc.drawImage(el, r.x, r.y, r.w, r.h)

  const p = Math.ceil(blur * 2)
  const pad = makeCanvas(W + 2 * p, H + 2 * p)
  const pc = pad.getContext("2d")!
  pc.imageSmoothingEnabled = false
  pc.drawImage(sharp, p, p)
  // edges
  pc.drawImage(sharp, 0, 0, 1, H, 0, p, p, H) // left
  pc.drawImage(sharp, W - 1, 0, 1, H, p + W, p, p, H) // right
  pc.drawImage(sharp, 0, 0, W, 1, p, 0, W, p) // top
  pc.drawImage(sharp, 0, H - 1, W, 1, p, p + H, W, p) // bottom
  // corners
  pc.drawImage(sharp, 0, 0, 1, 1, 0, 0, p, p)
  pc.drawImage(sharp, W - 1, 0, 1, 1, p + W, 0, p, p)
  pc.drawImage(sharp, 0, H - 1, 1, 1, 0, p + H, p, p)
  pc.drawImage(sharp, W - 1, H - 1, 1, 1, p + W, p + H, p, p)

  if (supportsCtxFilter()) {
    ctx.filter = `blur(${blur}px)`
    ctx.drawImage(pad, -p, -p)
    ctx.filter = "none"
    return
  }

  // Fallback (e.g. older Safari): blur a downsampled copy, then upscale.
  const d = Math.max(1, blur / 3)
  const sw = Math.max(1, Math.ceil(pad.width / d))
  const sh = Math.max(1, Math.ceil(pad.height / d))
  const small = makeCanvas(sw, sh)
  const smc = small.getContext("2d", { willReadFrequently: true })!
  smc.imageSmoothingQuality = "high"
  smc.drawImage(pad, 0, 0, sw, sh)
  const id = smc.getImageData(0, 0, sw, sh)
  softwareBlur(id.data, sw, sh, blur / d)
  smc.putImageData(id, 0, 0)
  ctx.drawImage(small, 0, 0, sw, sh, -p, -p, pad.width, pad.height)
}

// ─── Renderer ────────────────────────────────────────────────────────────────

/**
 * Drives one block canvas (+ optional blurred photo canvas) for a stage.
 * The real photo is a separate layer (an <img> with object-fit: cover, or
 * `photoCanvas` when blur > 0); the block canvas only ever holds blocks.
 */
export class PixelFilterRenderer {
  private blockCanvas: HTMLCanvasElement
  private photoCanvas: HTMLCanvasElement | null
  private settings: PixelSettings
  private el: HTMLImageElement | null = null
  private levels: Level[] = []
  private iw = 0
  private ih = 0
  private W = 0
  private H = 0
  private dpr = 1
  private grid: Grid | null = null
  private gridKey = ""
  private photoKey = ""
  private version = 0
  private raf = 0
  private lastNow = 0
  private destroyed = false
  /** Animation time (seconds × speed, integrated so speed changes don't jump). */
  t = 0

  constructor(blockCanvas: HTMLCanvasElement, photoCanvas: HTMLCanvasElement | null, settings: PixelSettings) {
    this.blockCanvas = blockCanvas
    this.photoCanvas = photoCanvas
    this.settings = { ...settings }
  }

  /** Pass a fully loaded <img>, or null to clear. */
  setImage(el: HTMLImageElement | null): void {
    this.version++
    this.el = el && el.naturalWidth > 0 ? el : null
    if (this.el) {
      this.iw = this.el.naturalWidth
      this.ih = this.el.naturalHeight
      this.levels = buildPyramid(this.el, this.iw, this.ih)
    } else {
      this.levels = []
    }
    this.refresh()
  }

  setSize(W: number, H: number, dpr?: number): void {
    const d = dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
    if (W === this.W && H === this.H && d === this.dpr) return
    this.W = W
    this.H = H
    this.dpr = d
    this.blockCanvas.width = Math.max(1, Math.round(W * d))
    this.blockCanvas.height = Math.max(1, Math.round(H * d))
    this.refresh()
  }

  setSettings(s: PixelSettings): void {
    this.settings = { ...s }
    this.refresh()
  }

  /** True when blocks could be sampled (false for no image or a CORS-tainted one). */
  hasBlocks(): boolean {
    return this.grid !== null
  }

  private refresh(): void {
    if (this.destroyed) return
    const s = this.settings
    const gk = `${this.version}|${this.W}|${this.H}|${s.pixelSize}`
    if (gk !== this.gridKey) {
      this.gridKey = gk
      this.grid = this.levels.length ? sampleGrid(this.levels, this.W, this.H, s.pixelSize) : null
    }
    if (this.photoCanvas && this.el && s.blur > 0) {
      const pk = `${this.version}|${this.W}|${this.H}|${this.dpr}|${s.blur}`
      if (pk !== this.photoKey) {
        this.photoKey = pk
        this.photoCanvas.width = Math.max(1, Math.round(this.W * this.dpr))
        this.photoCanvas.height = Math.max(1, Math.round(this.H * this.dpr))
        drawPhoto(this.photoCanvas, this.el, this.iw, this.ih, s.blur * this.dpr)
      }
    }
    if (s.motion !== "None" && this.grid) {
      if (!this.raf) {
        this.lastNow = 0
        this.raf = requestAnimationFrame(this.loop)
      }
    } else {
      this.stop()
      this.drawFrame()
    }
  }

  private loop = (now: number): void => {
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0
    this.lastNow = now
    this.t += dt * this.settings.speed
    this.drawFrame()
    this.raf = requestAnimationFrame(this.loop)
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private drawFrame(): void {
    const ctx = this.blockCanvas.getContext("2d")!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = "source-over"
    ctx.clearRect(0, 0, this.blockCanvas.width, this.blockCanvas.height)
    if (!this.grid) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    drawBlocks(ctx, this.grid, this.settings, this.t)
  }

  /**
   * Flattened frame at the image's natural resolution for the current viewport
   * crop (long edge ≤ 4096), with the current animation frame.
   */
  renderExport(): HTMLCanvasElement | null {
    if (!this.el || this.W < 1 || this.H < 1) return null
    const s = this.settings
    const scale = Math.max(this.W / this.iw, this.H / this.ih)
    let ew = this.W / scale
    let eh = this.H / scale
    // Frame matches the image's aspect (Fit): export the exact native size.
    if (Math.abs(ew - this.iw) < 3 && Math.abs(eh - this.ih) < 3) {
      ew = this.iw
      eh = this.ih
    }
    const long = Math.max(ew, eh)
    if (long > 4096) {
      ew *= 4096 / long
      eh *= 4096 / long
    }
    ew = Math.max(1, Math.round(ew))
    eh = Math.max(1, Math.round(eh))
    const k = ew / this.W

    const out = makeCanvas(ew, eh)
    drawPhoto(out, this.el, this.iw, this.ih, s.blur * k)

    if (this.grid) {
      const blocks = makeCanvas(ew, eh)
      const bc = blocks.getContext("2d")!
      bc.setTransform(k, 0, 0, eh / this.H, 0, 0)
      drawBlocks(bc, this.grid, s, this.t)
      const oc = out.getContext("2d")!
      oc.setTransform(1, 0, 0, 1, 0, 0)
      oc.globalCompositeOperation = BLEND_COMPOSITE[s.blend]
      oc.drawImage(blocks, 0, 0)
      oc.globalCompositeOperation = "source-over"
    }
    return out
  }

  destroy(): void {
    this.destroyed = true
    this.stop()
  }
}

# Pixel Filter: Design & Build Spec

A browser tool that adds an animated pixel-block overlay to any image. Users upload a photo, tweak the look in a floating control panel, then **export a PNG** or **copy a ready-to-paste Framer code component** with their settings built in.

The app is a single full-screen page with a floating panel. There are no marketing or explainer sections below it.

---

## 1. Tech stack

- **Vite + React + TypeScript**, no UI library.
- Rendering uses the **Canvas 2D API** (no WebGL needed).
- Fonts come from Google Fonts: **IBM Plex Mono** (all panel UI) and **Space Grotesk** (reserved for any larger text).
- Put the rendering engine in **one self-contained file** (`src/engine/pixelFilter.ts`) with no imports. The Framer snippet export embeds this exact file as text (see §7), so it must have zero dependencies.

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────┐
│ ┌─────────────┐                                          │
│ │ PIXEL FILTER│   full-viewport image + block overlay    │
│ │  controls   │                                          │
│ │     …       │                                          │
│ └─────────────┘                                          │
└──────────────────────────────────────────────────────────┘
```

- **Stage:** fills 100vw × 100vh. The image is drawn **cover**-style: it fills the frame and the overflow is cropped, centred. (There is no fit option.)
- **Panel:** floats top-left, 16px from the edges, **~215px wide**. Make it scrollable if it's taller than the viewport.
- **Layers, bottom to top:**
  1. `<img>` (or a blur canvas, see §5): the real photo, always visible
  2. `<canvas>` that draws **only the blocks**, using CSS `mix-blend-mode` for the Blend setting
  3. the control panel

The photo is never painted into the block canvas. If sampling fails (for example a CORS-tainted image), the blocks simply don't render and the photo shows untouched.

---

## 3. Control panel: visual spec

**Container**
- Background: dark translucent glass, `rgba(18,18,20,0.72)` with `backdrop-filter: blur(16px) saturate(140%)`
- Border: `1px solid rgba(255,255,255,0.08)`, radius `14px`, padding `14px`
- Subtle shadow: `0 10px 40px rgba(0,0,0,0.35)`

**Typography:** IBM Plex Mono, all caps, letter-spacing `0.12em`.
- Labels: 10px, `rgba(255,255,255,0.45)`
- Values: 11px, `rgba(255,255,255,0.9)`

**Header row:** a small white rounded square (8×8, radius 2) + "PIXEL FILTER" (12px, bold, white, letter-spacing 0.2em) + a **▾ toggle** on the right. The toggle collapses the panel to just the header row; the arrow rotates when collapsed. Animate the height (200ms ease).

**Upload button:** full width, height 32px, transparent fill, `1px solid rgba(255,255,255,0.7)`, pill radius, text "↑ UPLOAD IMAGE". Hover: fill `rgba(255,255,255,0.08)`. It triggers a hidden `<input type="file" accept="image/*">`. Also support **drag-and-drop** onto the stage.

**Dropdown row:** full width, height 32px, background `rgba(0,0,0,0.55)`, radius 8px. Label on the left, then value + "▾" on the right.
- Opens an inline list below it, same dark style.
- Each option has a small dot on its left: ○ unselected, ● selected.
- Clicking an option selects it and closes the list. Clicking outside or pressing Esc also closes it.

**Slider row:** label on the left, value on the right (formatted per the table), and a full-width range track below.
- Track: 2px, `rgba(255,255,255,0.18)`. The filled part to the left of the thumb is white.
- Thumb: 14px white circle with a soft shadow.

**Colour row** (only shown when Color = Custom): label "PIXEL" on the left; on the right, the hex text (e.g. `#9BE7D8`) + a 20×20 rounded swatch. Clicking the swatch opens a native `<input type="color">`. The hex text is also editable.

**Action buttons** (new, at the bottom of the panel): two side-by-side buttons in the same style as Upload.
- `↓ PNG`
- `⧉ FRAMER`

After a successful copy, the label briefly changes to "COPIED ✓" for 1.5s.

---

## 4. Controls (in panel order)

| # | Control | Type | Options / range | Default | Display format |
|---|---|---|---|---|---|
| 1 | Upload Image | button | image/* | — | — |
| 2 | Preset | dropdown | Custom, Mosaic, Ember, Ink, Grid, Bloom, Lattice, Chroma | Grid | name |
| 3 | Shape | dropdown | Square, Rounded, Circle, Diamond, Ring, Cross, Triangle, Hexagon | Square | name |
| 4 | Pixel Size | slider | 4 – 48, step 1 | 13 | `13` |
| 5 | Variation | slider | 0 – 1, step 0.01 | 0.20 | `0.20` |
| 6 | Fill | slider | 0.2 – 1.4, step 0.01 | 0.86 | `0.86` |
| 7 | Blur | slider | 0 – 40, step 1 | 0 | `0PX` |
| 8 | Coverage | dropdown | Full Range, Highlights, Midtones, Shadows | Midtones | name |
| 9 | Threshold | slider | 0 – 1, step 0.01 | 0.50 | `0.50` |
| 10 | Color | dropdown | White, Source, Custom | Source | name |
| 10a | Pixel colour | hex + swatch (only when Custom) | any hex | `#9BE7D8` | `#9BE7D8` |
| 11 | Blend | dropdown | Normal, Screen, Add, Multiply, Overlay | Screen | name |
| 12 | Motion | dropdown | None, Shimmer, Pulse, Wave, Scan, Rain, Sparkle, Flicker | Sparkle | name |
| 13 | Speed | slider | 0.1 – 3, step 0.05 | 0.25 | `0.25X` |
| 14 | Export | buttons | PNG · Framer | — | — |

**Preset behaviour:** picking a preset sets the values listed in §6. Every control stays visible and editable afterwards. Changing any control by hand switches Preset to **Custom**.

---

## 5. Rendering engine

### 5.1 Geometry
- Compute the **cover rect** of the image inside the stage: scale = `max(W/iw, H/ih)`, centred. The image layer and the sampling use **this one shared calculation**, so the blocks always line up with the photo.
- Handle devicePixelRatio: the canvas backing size is `W*dpr × H*dpr`.
- Recompute on resize (ResizeObserver) and when a new image loads.

### 5.2 Sampling (run when the image, size or pixel size changes, not every frame)
1. Draw the **sharp original** image (never the blurred one) into an offscreen canvas at the cover rect, downscaled so that **1 px = 1 cell**. Use `drawImage` with smoothing on to get an area-averaged colour per cell cheaply.
2. Read it with `getImageData` inside a try/catch. If it throws (CORS), set `blocks = []` and stop.
3. For each cell, store its average `r, g, b` and luminance `L = 0.2126r + 0.7152g + 0.0722b` (0–1).
4. **Auto-levels:** find the 2nd and 98th percentiles of L across all cells, then remap each cell's L to `Ln = clamp((L - p2) / (p98 - p2), 0, 1)`.

### 5.3 Block size per cell
```
toneSize   = mix(1, Ln, variation)            // variation 0 → flat mosaic, 1 → halftone
coverageW  = coverageWeight(Ln, coverage, threshold)
size       = cellSize * fill * toneSize * coverageW * motionScale(cell, t)
alpha      = coverageW * motionAlpha(cell, t)
skip the cell if size < 0.5px or alpha < 0.01
```

`coverageWeight`, with a fixed softness `s = 0.08` (smoothstep feather):
- **Full Range:** `1`
- **Highlights:** `smoothstep(threshold - s, threshold + s, Ln)`
- **Shadows:** `1 - smoothstep(threshold - s, threshold + s, Ln)`
- **Midtones:** the band centred at 0.5 with half-width `hw = 0.05 + threshold * 0.45`. The weight is `1 - smoothstep(hw - s, hw + s, |Ln - 0.5|)`.

### 5.4 Colour
- **White:** `#FFFFFF`
- **Source:** the cell's average colour
- **Custom:** the user's hex

### 5.5 Shapes
All shapes are drawn centred in the cell, with `size` as the bounding box. Every shape is a **solid uniform fill**, so even areas read as an even field. Build each shape as a `Path2D` and reuse it.

- **Square:** `fillRect`
- **Rounded:** rounded rect, radius = 25% of size
- **Circle:** arc
- **Diamond:** square rotated 45°, scaled to fit the box
- **Ring:** circle with an inner hole at 55% radius (evenodd fill)
- **Cross:** plus sign, arm thickness 30% of size
- **Triangle:** equilateral, pointing up
- **Hexagon:** pointy-top regular hexagon

### 5.6 Blend
Apply blending to the block canvas with CSS `mix-blend-mode`:

| Setting | CSS `mix-blend-mode` | Canvas `globalCompositeOperation` (for PNG export) |
|---|---|---|
| Normal | `normal` | `source-over` |
| Screen | `screen` | `screen` |
| Add | `plus-lighter` | `lighter` |
| Multiply | `multiply` | `multiply` |
| Overlay | `overlay` | `overlay` |

### 5.7 Blur
- Blur softens **only the photo layer**. The blocks keep sampling the sharp original, so they hold detail the blurred photo underneath has lost.
- **No zoom and no faded edges.** Draw the image onto a canvas that is padded on every side by `blur * 2` px, filling the padding with edge-clamped pixels (stretch the outermost row and column outward). Apply `ctx.filter = blur(Npx)`, then crop back to the cover rect. Use this canvas as the photo layer whenever blur > 0; use the plain `<img>` when blur = 0.

### 5.8 Motion
- Run a `requestAnimationFrame` loop with `t = elapsedSeconds * speed`.
- Give each cell a stable random seed `h` (hash of col/row, 0–1).
- Motion only multiplies size and alpha. It never moves blocks off the grid.
- **None** stops the loop and draws one static frame.

| Motion | motionScale | motionAlpha |
|---|---|---|
| None | 1 | 1 |
| Shimmer | `1 + 0.12·sin(2π(t·1.5 + h))` | `0.85 + 0.15·sin(2π(t·2 + h))` |
| Pulse | `0.85 + 0.15·sin(2π·t)` (whole image in sync) | 1 |
| Wave | `0.8 + 0.2·sin(2π(t - (col+row)·0.04))` (diagonal wave) | 1 |
| Scan | 1 | `0.35 + 0.65·exp(-((row/rows - fract(t·0.5))·8)²)`: a bright band sweeps top to bottom |
| Rain | 1 | per column, a falling streak: `pos = fract(t·0.6 + hash(col))`; `alpha = 0.3 + 0.7·max(0, 1 - (pos - row/rows)·6)` when the cell is behind the streak head, otherwise 0.3 |
| Sparkle | 1 | `0.55` base; about 3% of cells at any moment flare to 1.0 with a quick 0.4s rise-and-fade, re-picked randomly using `h` and `floor(t·2 + h)` |
| Flicker | 1 | `step`-random every ~0.12s per cell: `rand(h, floor(t·8)) > 0.15 ? 1 : 0.2` |

Performance target: 60fps at 1440p with pixel size ≥ 8. Batch draws per colour where possible. Sample only when inputs change.

---

## 6. Preset values

Each preset sets shape, coverage, cell size, colour, blend and motion. Variation, Fill and Threshold are tuned to suit. These are starting values to tune by eye. **No two presets should look alike.**

| Preset | Look | Shape | Size | Var | Fill | Coverage / Thr | Color | Blend | Motion |
|---|---|---|---|---|---|---|---|---|---|
| Mosaic | true pixelation | Square | 14 | 0.00 | 1.00 | Full Range / 0.50 | Source | Normal | None |
| Ember | warm highlights | Circle | 10 | 0.80 | 0.95 | Highlights / 0.60 | Custom `#FF7A2F` | Add | Pulse |
| Ink | dark stipple | Circle | 7 | 1.00 | 1.15 | Shadows / 0.45 | Custom `#0A0A0A` | Multiply | None |
| **Grid** (default) | rings on midtones | Square | 13 | 0.20 | 0.86 | Midtones / 0.50 | Source | Screen | Sparkle |
| Bloom | glowing dots | Circle | 16 | 0.70 | 1.20 | Highlights / 0.50 | White | Screen | Shimmer |
| Lattice | faint crosses | Cross | 18 | 0.30 | 0.70 | Full Range / 0.50 | White | Overlay | Wave |
| Chroma | source diamonds | Diamond | 12 | 0.60 | 1.05 | Full Range / 0.50 | Source | Normal | Flicker |

Blur = 0 and Speed = 0.25 for all presets.

---

## 7. Export

### 7.1 PNG export (`↓ PNG`)
- Render offscreen at the **image's natural resolution** (long edge capped at 4096px), using the **current viewport aspect ratio** with the cover crop, so the PNG matches what's on screen.
- Steps:
  1. Draw the photo layer (blurred if blur > 0).
  2. Set `globalCompositeOperation` from the Blend table.
  3. Draw the blocks for the **current animation frame**, with cell size scaled by `exportWidth / stageWidth` so the density matches the screen.
- Download as `pixel-filter-<preset>-<timestamp>.png` via `canvas.toBlob`.

### 7.2 Copy as Framer snippet (`⧉ FRAMER`)
Copies a complete Framer **code component** (`PixelFilter.tsx`) to the clipboard. The user pastes it into **Framer → Assets → Code → New file** and drops the component on the canvas.

The generated file must:
- Be a single `.tsx` file with **no imports except `react` and `framer`**. Inline the engine source from `src/engine/pixelFilter.ts` (import it in the app with Vite's `?raw` suffix).
- Export a default React component that renders the image (`object-fit: cover`) + the block canvas + the same render loop.
- Have the **current settings as the default props**.
- Expose every setting via `addPropertyControls`:
  - `image`: `ControlType.ResponsiveImage`
  - Enum controls for Shape, Coverage, Color, Blend, Motion (use `displaySegmentedControl` where there are ≤ 3 options)
  - Number controls with the same min/max/step as the panel
  - `pixelColor`: `ControlType.Color`, hidden unless Color = Custom
- Include the `// @framerSupportedLayoutWidth any` and `// @framerSupportedLayoutHeight any` annotations, so the component resizes freely.
- Leave the image prop empty by default. Uploaded files are local, so tell the user (in a small toast after copying): "Copied! Paste into Framer → Assets → Code, then set the image in the right panel."
- Use `navigator.clipboard.writeText`. If that fails, fall back to downloading the `.tsx` file.

---

## 8. Other behaviour
- **Default image:** load `public/default.jpg` on start. I'll supply this file; use any placeholder until then.
- Uploading a new image replaces the current one. Use `URL.createObjectURL` and revoke the old URL.
- Keyboard: `H` toggles the panel, `E` exports a PNG.
- On small screens (< 640px), the panel docks to the bottom as a sheet, collapsed by default.
- Respect `prefers-reduced-motion`: start with Motion = None.

---

## 9. Out of scope
- No landing or explainer page below the tool
- No video export
- No fit option (always cover)
- No video input

## 10. Done when
- [ ] All 13 controls work and update live
- [ ] Each of the 7 presets looks clearly different on the default image
- [ ] Changing a control switches Preset to Custom
- [ ] All 8 shapes, 5 blends and 8 motions render correctly
- [ ] PNG export matches the on-screen frame
- [ ] The copied Framer snippet pastes into a new Framer code file and works with no edits
- [ ] Panel collapses, scrolls if tall, and works on mobile

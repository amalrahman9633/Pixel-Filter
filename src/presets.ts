import type { PixelSettings } from "./engine/pixelFilter"

export type PresetName = "Custom" | "Mosaic" | "Ember" | "Ink" | "Grid" | "Bloom" | "Lattice" | "Chroma"
export const PRESET_NAMES: PresetName[] = ["Custom", "Mosaic", "Ember", "Ink", "Grid", "Bloom", "Lattice", "Chroma"]

export const DEFAULT_PIXEL_COLOR = "#9BE7D8"

type PresetValues = Omit<PixelSettings, "pixelColor"> & { pixelColor?: string }

const common = { blur: 0, speed: 0.25 }

export const PRESETS: Record<Exclude<PresetName, "Custom">, PresetValues> = {
  Mosaic: { ...common, shape: "Square", pixelSize: 14, variation: 0, fill: 1, coverage: "Full Range", threshold: 0.5, color: "Source", blend: "Normal", motion: "None" },
  Ember: { ...common, shape: "Circle", pixelSize: 10, variation: 0.8, fill: 0.95, coverage: "Highlights", threshold: 0.6, color: "Custom", pixelColor: "#FF7A2F", blend: "Add", motion: "Pulse" },
  Ink: { ...common, shape: "Circle", pixelSize: 7, variation: 1, fill: 1.15, coverage: "Shadows", threshold: 0.45, color: "Custom", pixelColor: "#0A0A0A", blend: "Multiply", motion: "None" },
  Grid: { ...common, shape: "Square", pixelSize: 13, variation: 0.2, fill: 0.86, coverage: "Midtones", threshold: 0.5, color: "Source", blend: "Screen", motion: "Sparkle" },
  Bloom: { ...common, shape: "Circle", pixelSize: 16, variation: 0.7, fill: 1.2, coverage: "Highlights", threshold: 0.5, color: "White", blend: "Screen", motion: "Shimmer" },
  Lattice: { ...common, shape: "Cross", pixelSize: 18, variation: 0.3, fill: 0.7, coverage: "Full Range", threshold: 0.5, color: "White", blend: "Overlay", motion: "Wave" },
  Chroma: { ...common, shape: "Diamond", pixelSize: 12, variation: 0.6, fill: 1.05, coverage: "Full Range", threshold: 0.5, color: "Source", blend: "Overlay", motion: "Flicker" }, // spec said Normal; Source+Normal camouflages into the photo
}

/** Applies a preset; presets without a custom colour keep the user's current pixel colour. */
export function applyPreset(name: Exclude<PresetName, "Custom">, current: PixelSettings): PixelSettings {
  const p = PRESETS[name]
  return { ...p, pixelColor: p.pixelColor ?? current.pixelColor }
}

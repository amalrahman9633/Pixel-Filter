import engineSource from "../engine/pixelFilter.ts?raw"
import template from "./PixelFilter.framer.tsx?raw"
import type { PixelSettings } from "../engine/pixelFilter"

/** Engine source with module `export`s removed so it can live inside the Framer file. */
export function inlineEngine(src: string): string {
  return src.replace(/^export\s+(?=(?:const|let|function|class|type|interface)\b)/gm, "")
}

/** Builds a complete, paste-ready Framer code component with `settings` as its defaults. */
export function buildFramerSnippet(settings: PixelSettings): string {
  const defaults = JSON.stringify(settings, null, 4)
  return template
    .replace("// __ENGINE__", () => inlineEngine(engineSource).trim())
    .replace("__DEFAULTS__", () => defaults)
}

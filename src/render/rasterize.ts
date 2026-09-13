/**
 * SVG -> PNG rasterization (issue #5).
 *
 * Uses @resvg/resvg-js - a native Rust SVG renderer with prebuilt binaries
 * for Linux/macOS/Windows (x64 + arm64), no browser, no system
 * dependencies, no network access at render time.
 *
 * Chosen over the alternatives after evaluating all three available in
 * this project's environment (see scripts/svg-to-png.mjs's original
 * header for the full comparison): ImageMagick's `convert` silently
 * drops `<filter>` primitives (no rsvg-convert binary here), and a
 * Playwright/Chromium screenshot needs a ~300MB browser download plus a
 * local HTTP server. resvg gives full `<filter>` (feGaussianBlur/
 * feMerge) and gradient support via a single ~4MB native addon and one
 * function call.
 */
import { Resvg } from "@resvg/resvg-js";

/** Rasterizes an SVG document string to a PNG image buffer. */
export function rasterizeSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  return resvg.render().asPng();
}

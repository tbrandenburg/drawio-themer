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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * resvg-js's fontdb does exact family-name matching only - it does not
 * perform OS-level fontconfig substitution (`fc-match`) the way browsers
 * or real draw.io do. Relying purely on `FONT_FALLBACK_STACK`'s family
 * names being installed on the host silently breaks on any machine
 * missing all of them (observed: a headless Linux box with only "Noto
 * Sans Mono" installed, no "Noto Sans"/"Helvetica Neue"/"Arial" - resvg
 * fell back to an arbitrary monospace font instead of a proportional
 * sans-serif). Bundling this one OFL-licensed TTF and registering it
 * explicitly via `font.fontFiles` guarantees "Noto Sans" (the first name
 * in `FONT_FALLBACK_STACK`, see ../render/svg.ts) always resolves
 * correctly, independent of what fonts the host happens to have.
 *
 * Bold/Italic/BoldItalic (issue #32) are bundled alongside Regular for
 * the same reason: once svg.ts emits font-weight="bold"/font-style=
 * "italic" from draw.io's fontStyle bitmask, resvg's fontdb needs a
 * matching face file to select - it does no synthetic bolding/slanting
 * and no OS-level substitution.
 */
const BUNDLED_FONT_PATH = join(MODULE_DIR, "assets", "NotoSans-Regular.ttf");
const BUNDLED_BOLD_FONT_PATH = join(MODULE_DIR, "assets", "NotoSans-Bold.ttf");
const BUNDLED_ITALIC_FONT_PATH = join(MODULE_DIR, "assets", "NotoSans-Italic.ttf");
const BUNDLED_BOLD_ITALIC_FONT_PATH = join(MODULE_DIR, "assets", "NotoSans-BoldItalic.ttf");

/**
 * Exported solely so tests can render with `loadSystemFonts: false` -
 * proving the bundled font file alone (independent of whatever fonts
 * the host happens to have) resolves "Noto Sans" and produces real
 * glyphs, not an empty/monospace fallback.
 */
export {
  BUNDLED_FONT_PATH,
  BUNDLED_BOLD_FONT_PATH,
  BUNDLED_ITALIC_FONT_PATH,
  BUNDLED_BOLD_ITALIC_FONT_PATH,
};

/** Options for {@link rasterizeSvgToPng}. */
export interface RasterizeOptions {
  /**
   * Output pixel density relative to the SVG's declared unit dimensions.
   * Defaults to 2, matching real draw.io's own retina-style PNG export
   * density (issue #23). Pass 1 for a legacy 1:1 render.
   */
  scale?: number;
}

/** Rasterizes an SVG document string to a PNG image buffer. */
export function rasterizeSvgToPng(svg: string, options?: RasterizeOptions): Buffer {
  const scale = options?.scale ?? 2;
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [
        BUNDLED_FONT_PATH,
        BUNDLED_BOLD_FONT_PATH,
        BUNDLED_ITALIC_FONT_PATH,
        BUNDLED_BOLD_ITALIC_FONT_PATH,
      ],
      loadSystemFonts: true,
      defaultFontFamily: "Noto Sans",
    },
    fitTo: {
      mode: "zoom",
      value: scale,
    },
  });
  return resvg.render().asPng();
}

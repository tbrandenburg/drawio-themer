/**
 * SVG -> PNG rasterization via headless Chromium (issue #34), opt-in
 * alternative to the default `resvg` backend in `rasterize.ts`.
 *
 * `resvg` is a static SVG interpreter: no `<foreignObject>`/HTML label
 * support, no real web font loading, and only partial CSS filter
 * support. This backend instead drives a real Chromium engine (via
 * `playwright-core`, no bundled browser download at `npm install` time)
 * to get closer to how real draw.io's own Electron-based PNG export
 * renders (`browser.capturePage()` against a live DOM).
 *
 * Requires a one-time `npx playwright install chromium` before use -
 * `playwright-core` itself ships no browser binaries. Not exercised by
 * the default `make test` gate; see `test/render/rasterize-chromium.ts`.
 */
import { chromium, type Browser } from "playwright-core";

export interface RasterizeChromiumOptions {
  /**
   * Output pixel density relative to the SVG's declared unit
   * dimensions. Defaults to 2, matching `rasterizeSvgToPng`'s default
   * (issue #23) so both backends produce comparably-sized output for
   * the same `--png-scale` value.
   */
  scale?: number;
}

/**
 * Lazily launched, process-wide singleton so multiple renders within a
 * single CLI invocation (`--png-original` + `--png-themed`) reuse one
 * Chromium instance instead of paying launch cost twice.
 */
let browserPromise: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ chromiumSandbox: false, args: ["--disable-dev-shm-usage"] });
  return browserPromise;
}

/** Rasterizes an SVG document string to a PNG image buffer using headless Chromium. */
export async function rasterizeSvgToPngChromium(
  svg: string,
  options?: RasterizeChromiumOptions,
): Promise<Buffer> {
  const scale = options?.scale ?? 2;
  const browser = await getBrowser();
  const page = await browser.newPage({ deviceScaleFactor: scale });
  try {
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, {
      waitUntil: "load",
    });
    // Runs inside the browser page context (has `document.fonts`), not
    // Node - cast via `globalThis` since this module's tsconfig has no
    // DOM lib and thus no ambient `Document`/`FontFaceSet` types.
    await page.evaluate(() => {
      const doc = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document;
      return doc?.fonts?.ready;
    });
    return await page.locator("svg").screenshot();
  } finally {
    await page.close();
  }
}

/**
 * Closes the shared Chromium instance, if one was launched. Callers
 * (e.g. the `apply` command) must call this once at the end of the CLI
 * process when the chromium backend was used, otherwise the launched
 * browser process keeps Node from exiting.
 */
export async function closeChromiumRasterizer(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = undefined;
  await browser.close();
}

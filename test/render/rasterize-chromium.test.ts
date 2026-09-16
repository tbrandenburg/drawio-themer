import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import {
  closeChromiumRasterizer,
  rasterizeSvgToPngChromium,
} from "../../src/render/rasterize-chromium.js";

const SIMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
  '<rect width="10" height="10" fill="#ff0000"/></svg>';

const TEXT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">' +
  '<rect width="200" height="40" fill="#ffffff"/>' +
  '<text x="5" y="28" font-family="sans-serif" font-size="24" fill="#000000">Test</text></svg>';

/** Reads width/height from a PNG buffer's IHDR chunk (bytes 16-23). */
function readPngDimensions(png: Buffer): { width: number; height: number } {
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

/**
 * Chromium is an opt-in dependency (issue #34): `playwright-core` alone
 * ships no browser binaries, and the default `make install`/`npm
 * install` must not trigger a Chromium download. Probe whether `npx
 * playwright install chromium` has actually been run on this machine by
 * attempting a real (cheap) launch, and skip this whole suite with a
 * clear message if it hasn't, so `make test` stays green without
 * chromium installed.
 */
async function isChromiumAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ chromiumSandbox: false });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const chromiumAvailable = await isChromiumAvailable();

describe.runIf(chromiumAvailable)("rasterizeSvgToPngChromium", () => {
  afterAll(async () => {
    await closeChromiumRasterizer();
  });

  it("produces a buffer with valid PNG magic bytes", async () => {
    const png = await rasterizeSvgToPngChromium(SIMPLE_SVG);

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("renders text into real (non-white) glyph pixels", async () => {
    const png = await rasterizeSvgToPngChromium(TEXT_SVG, { scale: 1 });

    // Decode via a minimal check: re-rasterize and inspect raw pixels is
    // overkill for a PNG buffer here, so instead assert the buffer is
    // non-trivially large - a blank 200x40 white PNG compresses far
    // smaller than one containing real glyph edges/anti-aliasing noise.
    expect(png.length).toBeGreaterThan(500);
  });

  it("defaults to a 2x render of the SVG's intrinsic pixel dimensions", async () => {
    const png = await rasterizeSvgToPngChromium(SIMPLE_SVG);

    const { width, height } = readPngDimensions(png);
    expect(width).toBe(20);
    expect(height).toBe(20);
  });

  it("honors a custom scale factor", async () => {
    const png = await rasterizeSvgToPngChromium(SIMPLE_SVG, { scale: 3 });

    const { width, height } = readPngDimensions(png);
    expect(width).toBe(30);
    expect(height).toBe(30);
  });
});

if (!chromiumAvailable) {
  describe("rasterizeSvgToPngChromium", () => {
    it.skip("skipped: chromium not installed (run `npx playwright install chromium` to enable)", () => {});
  });
}

beforeAll(() => {
  if (!chromiumAvailable) {
    console.warn(
      "[rasterize-chromium.test] Skipping chromium rasterizer tests: chromium browser not installed. " +
        "Run `npx playwright install chromium` to enable them.",
    );
  }
});

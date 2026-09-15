import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { BUNDLED_FONT_PATH, rasterizeSvgToPng } from "../../src/render/rasterize.js";

const SIMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
  '<rect width="10" height="10" fill="#ff0000"/></svg>';

describe("rasterizeSvgToPng", () => {
  it("produces a buffer with valid PNG magic bytes", () => {
    const png = rasterizeSvgToPng(SIMPLE_SVG);

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("renders 'Noto Sans' text into real glyphs using only the bundled font file, with system fonts disabled", () => {
    // Regression test for the "labels render in a fallback monospace
    // font on a host missing every name in FONT_FALLBACK_STACK" bug:
    // `loadSystemFonts: false` proves resolution succeeds purely via
    // the file bundled in src/render/assets, not whatever the CI/host
    // machine happens to have installed.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">' +
      '<rect width="200" height="40" fill="#ffffff"/>' +
      '<text x="5" y="28" font-family="Noto Sans" font-size="24" fill="#000000">Test</text></svg>';

    const resvg = new Resvg(svg, {
      font: {
        fontFiles: [BUNDLED_FONT_PATH],
        loadSystemFonts: false,
        defaultFontFamily: "Noto Sans",
      },
    });
    const rendered = resvg.render();
    const pixels = rendered.pixels;

    let nonWhitePixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) nonWhitePixels++;
    }

    // A real "Test" glyph run at font-size 24 covers well over 50px;
    // an empty/failed render would leave this at 0.
    expect(nonWhitePixels).toBeGreaterThan(50);
  });
});

import { describe, expect, it } from "vitest";
import { rasterizeSvgToPng } from "../../src/render/rasterize.js";

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
});

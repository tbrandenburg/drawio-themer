import { describe, expect, it } from "vitest";
import { compressDiagramContent, decompressDiagramContent } from "../../src/drawio/compression.js";

const SAMPLE_XML =
  '<mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel>';

describe("compression", () => {
  it("round-trips xml through compress/decompress", () => {
    const compressed = compressDiagramContent(SAMPLE_XML);
    const decompressed = decompressDiagramContent(compressed);
    expect(decompressed).toBe(SAMPLE_XML);
  });

  it("round-trips xml containing special/unicode characters", () => {
    const xml =
      '<mxGraphModel><root><mxCell id="1" value="ünïcödé &amp; 100% done" /></root></mxGraphModel>';
    const compressed = compressDiagramContent(xml);
    expect(decompressDiagramContent(compressed)).toBe(xml);
  });

  it("produces a base64 raw-deflate string decodable by an independent pako call", async () => {
    const pako = await import("pako");
    const compressed = compressDiagramContent(SAMPLE_XML);
    const raw = Buffer.from(compressed, "base64");
    const inflated = pako.inflateRaw(raw, { toText: true });
    expect(decodeURIComponent(inflated)).toBe(SAMPLE_XML);
  });

  it("throws a clear error on invalid base64/deflate content", () => {
    expect(() => decompressDiagramContent("not-valid-base64-deflate-data!!!")).toThrow(
      /could not be decompressed/i,
    );
  });

  it("throws a clear error on empty content", () => {
    expect(() => decompressDiagramContent("")).toThrow(/could not be decompressed/i);
  });
});

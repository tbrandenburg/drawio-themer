import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { applyCommand } from "../src/commands/apply.js";
import { loadDrawioDocument, getPages } from "../src/drawio/document.js";
import type { ApplyOptions } from "../src/types.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function expectPngFile(path: string): Promise<void> {
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);
}

/**
 * Decodes just enough of a non-interlaced RGBA/RGB PNG (as produced by
 * `resvg`) to read the top-left pixel's RGB, without pulling in a PNG
 * decoding dependency. Concatenates all `IDAT` chunks, inflates them, and
 * un-filters only the first scanline (sufficient for reading pixel (0,0)).
 */
async function readTopLeftPixelRgb(path: string): Promise<[number, number, number]> {
  const bytes = await readFile(path);
  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idatChunks.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  // Byte 0 of each scanline is the filter type; bytes 1-3 are the first
  // pixel's R/G/B. For the very first pixel of the first scanline, every
  // PNG filter type (None/Sub/Up/Average/Paeth) reconstructs to the same
  // raw filtered value, since there is no left/above neighbor (treated as
  // 0) - so no filter-specific unfiltering is needed here.
  return [raw.readUInt8(1), raw.readUInt8(2), raw.readUInt8(3)];
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toThrow();
}

const baseOptions: ApplyOptions = {
  theme: "shadcn-modern",
  dryRun: false,
  format: "preserve",
  verbose: false,
  themeMetadata: true,
};

const SIMPLE_FIXTURE = join(import.meta.dirname, "fixtures", "simple.drawio");

describe("applyCommand", () => {
  it("themes a real .drawio file and writes transformed output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const input = SIMPLE_FIXTURE;
    const output = join(dir, "output.drawio");

    await applyCommand(input, { ...baseOptions, output });

    const written = await readFile(output, "utf8");
    const inputContent = await readFile(input, "utf8");
    expect(written).not.toBe(inputContent);

    const doc = loadDrawioDocument(written);
    expect(doc.xmlDoc.documentElement?.getAttribute("drawio-themer")).toBe("shadcn-modern");
    const page = getPages(doc)[0];
    expect(page?.getModelXml()).toContain("fillColor=#ffffff");

    await rm(dir, { recursive: true, force: true });
  });

  it("throws and writes nothing when input file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const input = join(dir, "does-not-exist.drawio");
    const output = join(dir, "output.drawio");

    await expect(applyCommand(input, { ...baseOptions, output })).rejects.toThrow(
      /Could not read input file/,
    );

    await expect(readFile(output, "utf8")).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it("does not write output on --dry-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, output, dryRun: true });

    await expect(readFile(output, "utf8")).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it("throws a clear error for an invalid theme name/path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");

    await expect(
      applyCommand(SIMPLE_FIXTURE, { ...baseOptions, theme: "./does-not-exist.yaml", output }),
    ).rejects.toThrow(/Could not read theme/);

    await rm(dir, { recursive: true, force: true });
  });

  it("resolves the dark-neon-mode built-in theme by name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, theme: "dark-neon-mode", output });

    const doc = loadDrawioDocument(await readFile(output, "utf8"));
    expect(doc.xmlDoc.documentElement?.getAttribute("drawio-themer")).toBe("dark-neon-mode");

    await rm(dir, { recursive: true, force: true });
  });

  const ADDITIONAL_BUILTIN_THEMES = [
    "nord",
    "dracula",
    "solarized-light",
    "gruvbox",
    "catppuccin-mocha",
    "monokai",
    "github-light",
    "high-contrast",
  ];

  it.each(ADDITIONAL_BUILTIN_THEMES)("resolves the %s built-in theme by name", async (theme) => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, theme, output });

    const doc = loadDrawioDocument(await readFile(output, "utf8"));
    expect(doc.xmlDoc.documentElement?.getAttribute("drawio-themer")).toBe(theme);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("applyCommand --png-original / --png-themed", () => {
  it("writes both PNGs with valid magic bytes when both flags are given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngOriginal = join(dir, "before.png");
    const pngThemed = join(dir, "after.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, output, pngOriginal, pngThemed });

    await expectPngFile(pngOriginal);
    await expectPngFile(pngThemed);

    await rm(dir, { recursive: true, force: true });
  });

  it("writes only --png-original when --png-themed is omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngOriginal = join(dir, "before.png");
    const pngThemed = join(dir, "after.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, output, pngOriginal });

    await expectPngFile(pngOriginal);
    await expectMissing(pngThemed);

    await rm(dir, { recursive: true, force: true });
  });

  it("writes only --png-themed when --png-original is omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngOriginal = join(dir, "before.png");
    const pngThemed = join(dir, "after.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, output, pngThemed });

    await expectMissing(pngOriginal);
    await expectPngFile(pngThemed);

    await rm(dir, { recursive: true, force: true });
  });

  it("writes neither PNG when neither flag is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngOriginal = join(dir, "before.png");
    const pngThemed = join(dir, "after.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, output });

    await expectMissing(pngOriginal);
    await expectMissing(pngThemed);

    await rm(dir, { recursive: true, force: true });
  });

  it("renders --png-themed with the theme's own dark background, not white", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngThemed = join(dir, "after.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, theme: "nord", output, pngThemed });

    const [r, g, b] = await readTopLeftPixelRgb(pngThemed);
    // nord.yaml's `background` token is #2e3440 (46, 52, 64) - assert the
    // canvas corner is dark, not the renderer's white default (255,255,255).
    expect(r).toBeLessThan(80);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);

    await rm(dir, { recursive: true, force: true });
  });

  it("renders --png-original with a white background regardless of the target theme", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const output = join(dir, "output.drawio");
    const pngOriginal = join(dir, "before.png");

    await applyCommand(SIMPLE_FIXTURE, { ...baseOptions, theme: "nord", output, pngOriginal });

    const [r, g, b] = await readTopLeftPixelRgb(pngOriginal);
    expect([r, g, b]).toEqual([255, 255, 255]);

    await rm(dir, { recursive: true, force: true });
  });
});

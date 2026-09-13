import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCommand } from "../src/commands/apply.js";
import { loadDrawioDocument, getPages } from "../src/drawio/document.js";
import type { ApplyOptions } from "../src/types.js";

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
});

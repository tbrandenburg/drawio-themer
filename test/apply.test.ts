import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCommand } from "../src/commands/apply.js";
import type { ApplyOptions } from "../src/types.js";

const baseOptions: ApplyOptions = {
  theme: "shadcn-modern",
  dryRun: false,
  format: "preserve",
  verbose: false,
  themeMetadata: true,
};

describe("applyCommand", () => {
  it("copies input contents to output unchanged (passthrough)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const input = join(dir, "input.drawio");
    const output = join(dir, "output.drawio");
    const content = "<mxfile><diagram>fake content</diagram></mxfile>";
    await writeFile(input, content);

    await applyCommand(input, { ...baseOptions, output });

    const written = await readFile(output, "utf8");
    expect(written).toBe(content);

    await rm(dir, { recursive: true, force: true });
  });

  it("throws and writes nothing when input file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const input = join(dir, "does-not-exist.drawio");
    const output = join(dir, "output.drawio");

    await expect(applyCommand(input, { ...baseOptions, output })).rejects.toThrow(/Could not read input file/);

    await expect(readFile(output, "utf8")).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it("does not write output on --dry-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drawio-themer-"));
    const input = join(dir, "input.drawio");
    const output = join(dir, "output.drawio");
    await writeFile(input, "content");

    await applyCommand(input, { ...baseOptions, output, dryRun: true });

    await expect(readFile(output, "utf8")).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });
});

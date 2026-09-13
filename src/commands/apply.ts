import { readFile, writeFile } from "node:fs/promises";
import type { ApplyOptions } from "../types.js";

/**
 * Phase 1 implementation of the `apply` command.
 *
 * This is intentionally a byte-passthrough: it reads the input file and
 * writes it back out unchanged. No XML parsing, compression handling, or
 * theming logic is implemented yet (see PRD phases 2-7).
 *
 * `--format`, `--verbose`, and `--theme-metadata` are accepted for CLI
 * shape compatibility but are no-ops in this phase.
 */
export async function applyCommand(input: string, options: ApplyOptions): Promise<void> {
  let contents: Buffer;
  try {
    contents = await readFile(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read input file "${input}": ${reason}`, { cause: error });
  }

  if (options.dryRun) {
    process.stdout.write(`Dry run: would apply theme "${options.theme}" to "${input}".\n`);
    return;
  }

  if (!options.output) {
    throw new Error("An output file is required unless --dry-run is set (use -o/--output).");
  }

  try {
    await writeFile(options.output, contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not write output file "${options.output}": ${reason}`, { cause: error });
  }

  process.stdout.write(`Theme: ${options.theme}\nOutput: ${options.output}\n`);
}

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ApplyOptions, CellClass, TransformStats, VerboseCellDetail } from "../types.js";
import { loadTheme } from "../theme/loader.js";
import { compileTheme } from "../theme/compiler.js";
import { transformDrawioXml } from "../drawio/transform.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Built-in theme name -> bundled YAML file path (PRD section 6). */
const BUILTIN_THEMES: Record<string, string> = {
  "shadcn-modern": join(MODULE_DIR, "..", "themes", "shadcn-modern.yaml"),
  "dark-neon-mode": join(MODULE_DIR, "..", "themes", "dark-neon-mode.yaml"),
  nord: join(MODULE_DIR, "..", "themes", "nord.yaml"),
  dracula: join(MODULE_DIR, "..", "themes", "dracula.yaml"),
  "solarized-light": join(MODULE_DIR, "..", "themes", "solarized-light.yaml"),
  gruvbox: join(MODULE_DIR, "..", "themes", "gruvbox.yaml"),
  "catppuccin-mocha": join(MODULE_DIR, "..", "themes", "catppuccin-mocha.yaml"),
  monokai: join(MODULE_DIR, "..", "themes", "monokai.yaml"),
  "github-light": join(MODULE_DIR, "..", "themes", "github-light.yaml"),
  "high-contrast": join(MODULE_DIR, "..", "themes", "high-contrast.yaml"),
};

async function resolveThemeSource(theme: string): Promise<string> {
  const builtinPath = BUILTIN_THEMES[theme];
  const path = builtinPath ?? theme;
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read theme "${theme}": ${reason}`, { cause: error });
  }
}

const CLASS_STAT_ORDER: Array<{ cls: CellClass; label: string }> = [
  { cls: "node", label: "Nodes" },
  { cls: "container", label: "Containers" },
  { cls: "database", label: "Databases" },
  { cls: "edge", label: "Edges" },
  { cls: "text", label: "Text cells" },
  { cls: "image", label: "Images" },
  { cls: "group", label: "Groups" },
];

function printStats(stats: TransformStats, output: string): void {
  const lines: string[] = [
    `✓ Theme: ${stats.themeName}`,
    `✓ Pages: ${stats.pages}`,
    `✓ Cells inspected: ${stats.cellsInspected}`,
  ];
  for (const { cls, label } of CLASS_STAT_ORDER) {
    const count = stats.themedByClass[cls] ?? 0;
    if (count > 0) lines.push(`✓ ${label} themed: ${count}`);
  }
  lines.push(`✓ Cells skipped: ${stats.cellsSkipped}`);
  lines.push(`✓ Output: ${output}`);
  process.stdout.write(lines.join("\n") + "\n");
}

function printVerboseDetails(details: VerboseCellDetail[]): void {
  for (const detail of details) {
    process.stdout.write(`${detail.label}\n`);
    if (detail.classes.length > 0) {
      process.stdout.write(`  ${detail.classes.join(", ")}\n`);
    }
    if (detail.semanticTags.length > 0) {
      process.stdout.write(`  ${detail.semanticTags.join(", ")}\n`);
    }
    process.stdout.write(`  changed ${detail.changedProperties.join(", ")}\n`);
  }
}

/**
 * Phase 6 implementation of the `apply` command (PRD section 17): reads
 * the input `.drawio` file, resolves and compiles the requested theme,
 * runs the full transformation pipeline, then writes the themed output
 * (unless `--dry-run`) and prints statistics (PRD section 25).
 */
export async function applyCommand(input: string, options: ApplyOptions): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(input, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read input file "${input}": ${reason}`, { cause: error });
  }

  const themeSource = await resolveThemeSource(options.theme);
  const themeInput = loadTheme(themeSource);
  const compiledTheme = compileTheme(themeInput);

  const { outputXml, stats, verboseDetails } = transformDrawioXml(contents, compiledTheme, {
    format: options.format,
    verbose: options.verbose,
    themeMetadata: options.themeMetadata,
  });

  if (options.dryRun) {
    if (options.verbose) printVerboseDetails(verboseDetails);
    printStats(stats, "(dry run - not written)");
    return;
  }

  if (!options.output) {
    throw new Error("An output file is required unless --dry-run is set (use -o/--output).");
  }

  try {
    await writeFile(options.output, outputXml);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not write output file "${options.output}": ${reason}`, { cause: error });
  }

  if (options.verbose) printVerboseDetails(verboseDetails);
  printStats(stats, options.output);
}

#!/usr/bin/env node
import { Command } from "commander";
import { applyCommand } from "./commands/apply.js";
import type { ApplyOptions, OutputFormat } from "./types.js";

const VALID_FORMATS: OutputFormat[] = ["preserve", "compressed", "uncompressed"];

function parseFormat(value: string): OutputFormat {
  if (!VALID_FORMATS.includes(value as OutputFormat)) {
    throw new Error(
      `Invalid --format value "${value}". Expected one of: ${VALID_FORMATS.join(", ")}.`,
    );
  }
  return value as OutputFormat;
}

const program = new Command();

program
  .name("drawio-themer")
  .description("Apply modern visual themes to existing draw.io / diagrams.net files.")
  .version("0.1.0");

program
  .command("apply")
  .description("Apply a theme to a .drawio file")
  .argument("<input>", "Input .drawio file")
  .requiredOption("-t, --theme <theme>", "Built-in theme name or theme file")
  .option("-o, --output <file>", "Output .drawio file")
  .option("--dry-run", "Analyze without writing", false)
  .option("--format <format>", "preserve | compressed | uncompressed", parseFormat, "preserve")
  .option("--verbose", "Show matching/transformation details", false)
  .option("--no-theme-metadata", "Do not annotate generated file")
  .option(
    "--png-original <file>",
    "Render the input (pre-theme) file as an approximate PNG render (not a substitute for real draw.io)",
  )
  .option(
    "--png, --png-themed <file>",
    "Render the themed output as an approximate PNG render (not a substitute for real draw.io)",
  )
  .option(
    "--svg-original <file>",
    "Render the input (pre-theme) file as an approximate SVG render (not a substitute for real draw.io)",
  )
  .option(
    "--svg, --svg-themed <file>",
    "Render the themed output as an approximate SVG render (not a substitute for real draw.io)",
  )
  .action(async (input: string, options: Record<string, unknown>) => {
    const applyOptions: ApplyOptions = {
      theme: options.theme as string,
      output: options.output as string | undefined,
      dryRun: Boolean(options.dryRun),
      format: options.format as OutputFormat,
      verbose: Boolean(options.verbose),
      themeMetadata: options.themeMetadata !== false,
      pngOriginal: options.pngOriginal as string | undefined,
      pngThemed: options.pngThemed as string | undefined,
      svgOriginal: options.svgOriginal as string | undefined,
      svgThemed: options.svgThemed as string | undefined,
    };

    try {
      await applyCommand(input, applyOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

/**
 * Minimal shared types for the CLI skeleton (Phase 1).
 *
 * Richer domain types (CellDescriptor, ThemeRule, CompiledTheme, etc. from
 * PRD section 21) belong to later phases and are intentionally not defined
 * here yet.
 */

/** Output encoding mode for the generated .drawio file. Currently a no-op. */
export type OutputFormat = "preserve" | "compressed" | "uncompressed";

/** Parsed options for the `apply` command. */
export interface ApplyOptions {
  theme: string;
  output?: string;
  dryRun: boolean;
  format: OutputFormat;
  verbose: boolean;
  themeMetadata: boolean;
}

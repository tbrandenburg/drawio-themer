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

/**
 * Structured representation of a draw.io mxCell `style` attribute
 * (PRD section 8, "draw.io Style Model").
 *
 * A style string is a semicolon-delimited list of fragments. Each fragment
 * is either:
 *  - a `key=value` pair, stored in `properties`, or
 *  - a bare token with no `=`, stored in `tokens`.
 */
export interface ParsedStyle {
  tokens: string[];
  properties: Record<string, string>;
}

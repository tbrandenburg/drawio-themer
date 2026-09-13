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

/**
 * Internal classification tags a cell can receive (PRD section 11,
 * "Classification").
 */
export type CellClass = "image" | "text" | "container" | "database" | "edge" | "node";

/**
 * Result of classifying a single `<mxCell>` (see
 * `src/drawio/classifier.ts`).
 *
 * `classes` lists every applicable class, most specific first (priority
 * order per PRD Phase 4: image > text > container > database > edge >
 * node); callers may match on any entry, and the first entry is the
 * "primary" classification.
 *
 * `semanticTags` lists derived `role:`/`tag:` metadata tags from an
 * enclosing `<object>`/`<UserObject>` wrapper, kept separate from
 * `classes` because they describe author intent, not shape appearance.
 */
export interface CellClassification {
  classes: CellClass[];
  semanticTags: string[];
}

/**
 * A theme rule's selector, fully compiled (PRD section 11/12/15). Every
 * field is optional; a rule matches a cell only if every field it
 * specifies matches (AND semantics). See `src/theme/matcher.ts`.
 */
export interface CompiledSelector {
  kind?: CellClass;
  shape?: string;
  tag?: string;
  role?: string;
}

/**
 * A single theme rule after token resolution (PRD section 16, "Theme
 * Resolution Pipeline"). `style` contains only allow-listed properties
 * (PRD section 10) with all `$token` references resolved to concrete
 * string values.
 */
export interface CompiledRule {
  selector: CompiledSelector;
  style: Record<string, string>;
}

/**
 * Fully resolved theme, ready for Phase 6's transformer to apply (PRD
 * section 16). `defaults` and every rule's `style` have no `$refs` left.
 */
export interface CompiledTheme {
  name: string;
  defaults: Record<string, string>;
  rules: CompiledRule[];
}

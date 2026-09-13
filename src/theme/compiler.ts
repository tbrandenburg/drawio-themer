/**
 * Theme compiler (PRD section 16 "Theme Resolution Pipeline" / Phase 5).
 *
 * Resolves `$tokenName` references in `defaults` and every rule's
 * `style` against the theme's `tokens` table, producing a fully
 * resolved `CompiledTheme` with no `$refs` left.
 *
 * This module owns BOTH responsibilities for the PRD section 10 "Style
 * Property Policy" allow-list:
 *   1. rejecting (fatal error) any rule `style` key that is not on the
 *      allow-list (e.g. `shape`, `container`, `image` - properties that
 *      affect topology/geometry/shape-type and must never be set by a
 *      theme rule, per the "Golden Rule: Preserve Semantics").
 *   2. resolving every allowed property's value.
 *
 * Phase 6 (transformer) does NOT need to re-check the allow-list: by
 * the time a `CompiledRule` exists, its `style` is guaranteed to only
 * contain allow-listed keys.
 */
import type { CompiledRule, CompiledTheme } from "../types.js";
import type { ThemeInput } from "./schema.js";

/**
 * PRD section 10 allow-list: only these style properties may be set by
 * a theme (`defaults` or a rule's `style`). Everything else - shape,
 * edgeStyle, perimeter, container, swimlane, image, imageAspect,
 * rotation, direction, flipH, flipV, etc. - affects topology, geometry,
 * shape type, layout, embedding, or behavior and must be preserved.
 */
const ALLOWED_STYLE_PROPERTIES = new Set([
  "fillColor",
  "gradientColor",
  "strokeColor",
  "strokeWidth",
  "fontColor",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "rounded",
  "arcSize",
  "shadow",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "spacing",
  "spacingTop",
  "spacingRight",
  "spacingBottom",
  "spacingLeft",
  "endArrow",
  "startArrow",
  "endFill",
  "startFill",
  "dashed",
  "dashPattern",
  // Also permitted: draw.io's generic "wrap text" flag used in the PRD's
  // own bundled theme example (section 12). Purely a text-layout
  // presentational flag, not topology/geometry/shape-type.
  "whiteSpace",
]);

function isTokenRef(value: string): string | undefined {
  return value.startsWith("$") ? value.slice(1) : undefined;
}

/**
 * Resolves a single style value against the token table. Numbers are
 * coerced to strings (draw.io style values are always strings).
 * Collects any missing token name into `missingTokens` rather than
 * throwing immediately, so a single `compileTheme` call reports every
 * missing reference at once.
 */
function resolveValue(
  value: string | number,
  tokens: Record<string, string>,
  missingTokens: Set<string>,
): string {
  if (typeof value === "number") return String(value);

  const tokenName = isTokenRef(value);
  if (tokenName === undefined) return value;

  const resolved = tokens[tokenName];
  if (resolved === undefined) {
    missingTokens.add(tokenName);
    return value;
  }
  return resolved;
}

function resolveStyleMap(
  style: Record<string, string | number>,
  tokens: Record<string, string>,
  missingTokens: Set<string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    resolved[key] = resolveValue(value, tokens, missingTokens);
  }
  return resolved;
}

/**
 * Compiles a validated `ThemeInput` into a `CompiledTheme`.
 *
 * @throws Error listing every missing `$token` reference found across
 * `defaults` and all rules (PRD section 16: "Missing token references
 * are fatal validation errors").
 * @throws Error listing every disallowed style property used by a rule
 * (PRD section 10 allow-list).
 */
export function compileTheme(input: ThemeInput): CompiledTheme {
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tokens)) {
    tokens[name] = String(value);
  }

  const missingTokens = new Set<string>();
  const forbiddenProperties = new Set<string>();

  const defaults = resolveStyleMap(input.defaults, tokens, missingTokens);

  const rules: CompiledRule[] = input.rules.map((rule) => {
    for (const key of Object.keys(rule.style)) {
      if (!ALLOWED_STYLE_PROPERTIES.has(key)) forbiddenProperties.add(key);
    }
    return {
      selector: { ...rule.selector },
      style: resolveStyleMap(rule.style, tokens, missingTokens),
    };
  });

  if (forbiddenProperties.size > 0) {
    throw new Error(
      `Theme "${input.name}" uses disallowed style properties (PRD section 10 allow-list): ${[...forbiddenProperties].sort().join(", ")}`,
    );
  }

  if (missingTokens.size > 0) {
    throw new Error(
      `Theme "${input.name}" references undefined tokens: ${[...missingTokens].sort().join(", ")}`,
    );
  }

  return { name: input.name, defaults, rules };
}

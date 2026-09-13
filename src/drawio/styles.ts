/**
 * draw.io style string parser/serializer/merger (PRD section 8).
 *
 * Pure string/object logic only - no XML awareness. Kept intentionally
 * small and thoroughly tested per PRD Phase 3 guidance.
 */

import type { ParsedStyle } from "../types.js";

/**
 * Parses a draw.io style string (e.g.
 * `"rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;"`) into a
 * structured `ParsedStyle`.
 *
 * Each `;`-delimited fragment is trimmed. Fragments containing `=` are
 * split on the FIRST `=` only (values may themselves contain `=`) and
 * stored as `properties[key] = value`. Fragments with no `=` are stored
 * as bare `tokens`. Empty fragments (from leading/trailing/duplicate
 * semicolons) are ignored.
 */
export function parseStyle(style: string): ParsedStyle {
  const tokens: string[] = [];
  const properties: Record<string, string> = {};

  for (const rawFragment of style.split(";")) {
    const fragment = rawFragment.trim();
    if (fragment === "") continue;

    const eqIndex = fragment.indexOf("=");
    if (eqIndex === -1) {
      tokens.push(fragment);
      continue;
    }

    const key = fragment.slice(0, eqIndex).trim();
    const value = fragment.slice(eqIndex + 1).trim();
    properties[key] = value;
  }

  return { tokens, properties };
}

/**
 * Serializes a `ParsedStyle` back into a valid draw.io style string.
 *
 * Order: bare tokens first, then `key=value` properties in the object's
 * key insertion order. Exact key order from the original input is not
 * preserved (not required by the round-trip guarantee, which only
 * requires property/token set equality); this keeps the implementation
 * simple. Every fragment is terminated with `;`.
 */
export function serializeStyle(parsed: ParsedStyle): string {
  const fragments: string[] = [
    ...parsed.tokens,
    ...Object.entries(parsed.properties).map(([key, value]) => `${key}=${value}`),
  ];

  if (fragments.length === 0) return "";

  return fragments.map((fragment) => `${fragment};`).join("");
}

/**
 * Merges `overrides` onto `base` without losing unrelated information
 * from `base` (PRD section 9, "Golden Rule: Preserve Semantics").
 *
 * - `properties`: shallow-merged, override wins on key collision.
 * - `tokens`: unioned and deduplicated (order: base tokens first, then
 *   any new override tokens not already present).
 */
export function mergeStyle(base: ParsedStyle, overrides: Partial<ParsedStyle>): ParsedStyle {
  const properties = { ...base.properties, ...(overrides.properties ?? {}) };

  const tokens = [...base.tokens];
  for (const token of overrides.tokens ?? []) {
    if (!tokens.includes(token)) tokens.push(token);
  }

  return { tokens, properties };
}

/**
 * Rule matcher (PRD section 15 "Cascading" / Phase 5).
 *
 * Given a cell's classification and a compiled theme's rules, returns
 * the ordered subset of rules whose selector matches - in original file
 * order, so Phase 6's transformer can apply them sequentially and get
 * "last applicable rule wins for each property" for free via repeated
 * `mergeStyle` calls.
 */
import type { CellClassification, CompiledRule, CompiledSelector } from "../types.js";

function selectorMatches(selector: CompiledSelector, classification: CellClassification): boolean {
  if (selector.kind !== undefined && !classification.classes.includes(selector.kind)) {
    return false;
  }
  if (selector.tag !== undefined && !classification.semanticTags.includes(`tag:${selector.tag}`)) {
    return false;
  }
  if (
    selector.role !== undefined &&
    !classification.semanticTags.includes(`role:${selector.role}`)
  ) {
    return false;
  }
  if (selector.shape !== undefined && classification.shape !== selector.shape) {
    return false;
  }
  return true;
}

/**
 * Returns the subset of `rules` whose selector matches `classification`,
 * preserving original file order.
 */
export function matchRules(
  classification: CellClassification,
  rules: CompiledRule[],
): CompiledRule[] {
  return rules.filter((rule) => selectorMatches(rule.selector, classification));
}

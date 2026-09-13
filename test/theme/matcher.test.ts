import { describe, expect, it } from "vitest";
import { compileTheme } from "../../src/theme/compiler.js";
import { loadTheme } from "../../src/theme/loader.js";
import { matchRules } from "../../src/theme/matcher.js";
import type { CellClassification, CompiledRule } from "../../src/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shadcnModernPath = fileURLToPath(new URL("../../src/themes/shadcn-modern.yaml", import.meta.url));

function classification(classes: CellClassification["classes"], semanticTags: string[] = []): CellClassification {
  return { classes, semanticTags };
}

describe("matchRules", () => {
  it("matches a rule with an empty selector against anything", () => {
    const rules: CompiledRule[] = [{ selector: {}, style: { fillColor: "#fff" } }];
    expect(matchRules(classification(["node"]), rules)).toEqual(rules);
  });

  it("matches on kind", () => {
    const nodeRule: CompiledRule = { selector: { kind: "node" }, style: {} };
    const edgeRule: CompiledRule = { selector: { kind: "edge" }, style: {} };
    expect(matchRules(classification(["node"]), [nodeRule, edgeRule])).toEqual([nodeRule]);
  });

  it("matches on tag and role via semanticTags", () => {
    const tagRule: CompiledRule = { selector: { tag: "primary" }, style: {} };
    const roleRule: CompiledRule = { selector: { role: "service" }, style: {} };
    const cell = classification(["node"], ["tag:primary", "role:service"]);
    expect(matchRules(cell, [tagRule, roleRule])).toEqual([tagRule, roleRule]);
  });

  it("does not match shape selectors (not yet supported)", () => {
    const shapeRule: CompiledRule = { selector: { shape: "cylinder3" }, style: {} };
    expect(matchRules(classification(["database"]), [shapeRule])).toEqual([]);
  });

  it("requires ALL specified selector fields to match (AND semantics)", () => {
    const rule: CompiledRule = { selector: { kind: "node", tag: "primary" }, style: {} };
    expect(matchRules(classification(["node"], []), [rule])).toEqual([]);
    expect(matchRules(classification(["node"], ["tag:primary"]), [rule])).toEqual([rule]);
  });

  it("preserves original file order for cascading (PRD section 15)", () => {
    const source = readFileSync(shadcnModernPath, "utf8");
    const compiled = compileTheme(loadTheme(source));

    // Per Phase 4 handoff notes: the classifier does not co-tag a
    // database cell with "node" (database is a distinct, more specific
    // class than the generic node fallback). So a "primary database"
    // cell here has classes: ["database"] and semanticTags:
    // ["tag:primary"] - it matches the `kind: database` and `tag:
    // primary` rules, but never `kind: node`.
    const cell = classification(["database"], ["tag:primary"]);
    const matched = matchRules(cell, compiled.rules);

    const kinds = matched.map((rule) => rule.selector.kind ?? rule.selector.tag);
    expect(kinds).toEqual(["database", "primary"]);
    expect(matched.some((rule) => rule.selector.kind === "node")).toBe(false);
  });
});

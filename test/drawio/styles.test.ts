import { describe, expect, it } from "vitest";
import { mergeStyle, parseStyle, serializeStyle } from "../../src/drawio/styles.js";
import type { ParsedStyle } from "../../src/types.js";

describe("parseStyle", () => {
  it("parses empty string to empty tokens/properties", () => {
    expect(parseStyle("")).toEqual({ tokens: [], properties: {} });
  });

  it("treats trailing semicolon as optional", () => {
    expect(parseStyle("a=1;b=2")).toEqual(parseStyle("a=1;b=2;"));
  });

  it("ignores empty fragments between/around semicolons", () => {
    expect(parseStyle("a=1;;b=2;")).toEqual({
      tokens: [],
      properties: { a: "1", b: "2" },
    });
  });

  it("splits key=value only on the first '=' (defensive against '=' in values)", () => {
    expect(parseStyle("label=a=b=c;")).toEqual({
      tokens: [],
      properties: { label: "a=b=c" },
    });
  });

  it("trims whitespace around fragments", () => {
    expect(parseStyle(" a=1 ; dashed ; b=2 ")).toEqual({
      tokens: ["dashed"],
      properties: { a: "1", b: "2" },
    });
  });

  it("separates bare tokens (no '=') from key=value properties", () => {
    expect(
      parseStyle("rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#e2e8f0;"),
    ).toEqual({
      tokens: [],
      properties: {
        rounded: "1",
        whiteSpace: "wrap",
        html: "1",
        fillColor: "#ffffff",
        strokeColor: "#e2e8f0",
      },
    });

    expect(parseStyle("dashed;rounded=1;")).toEqual({
      tokens: ["dashed"],
      properties: { rounded: "1" },
    });
  });
});

describe("serializeStyle", () => {
  it("serializes empty ParsedStyle to empty string", () => {
    expect(serializeStyle({ tokens: [], properties: {} })).toBe("");
  });

  it("produces a semicolon-terminated key=value/token string", () => {
    const parsed: ParsedStyle = {
      tokens: ["dashed"],
      properties: { rounded: "1", fillColor: "#ffffff" },
    };
    const result = serializeStyle(parsed);
    expect(result.endsWith(";")).toBe(true);
    expect(result).toContain("dashed;");
    expect(result).toContain("rounded=1;");
    expect(result).toContain("fillColor=#ffffff;");
  });

  it("round-trips through parseStyle with semantically equivalent result", () => {
    const original =
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#e2e8f0;dashed;";
    const parsed = parseStyle(original);
    const reparsed = parseStyle(serializeStyle(parsed));
    expect(reparsed).toEqual(parsed);
  });
});

describe("mergeStyle", () => {
  it("overrides colliding property keys while keeping unrelated base properties", () => {
    const base = parseStyle("shape=cylinder3;fillColor=#dae8fc;fontColor=#000000;");
    const merged = mergeStyle(base, { properties: { fillColor: "#fafafa" } });

    expect(merged.properties).toEqual({
      shape: "cylinder3",
      fillColor: "#fafafa",
      fontColor: "#000000",
    });
  });

  it("unions and dedups tokens from base and overrides", () => {
    const base: ParsedStyle = { tokens: ["dashed"], properties: {} };
    const merged = mergeStyle(base, { tokens: ["dashed", "rounded"] });

    expect(merged.tokens).toEqual(["dashed", "rounded"]);
  });

  it("does not mutate base or lose tokens/properties when overrides touch only a subset", () => {
    const base: ParsedStyle = {
      tokens: ["dashed"],
      properties: { shape: "cylinder3", fillColor: "#dae8fc" },
    };
    const baseSnapshot = structuredClone(base);

    mergeStyle(base, { properties: { fillColor: "#fafafa" } });

    expect(base).toEqual(baseSnapshot);
  });

  it("PRD section 9: preserves shape=cylinder3 while applying color overrides", () => {
    const base = parseStyle(
      "shape=cylinder3;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#000000;",
    );
    const merged = mergeStyle(base, {
      properties: {
        fillColor: "#fafafa",
        strokeColor: "#d4d4d8",
        fontColor: "#18181b",
        strokeWidth: "1",
      },
    });

    const serialized = serializeStyle(merged);

    expect(serialized).toContain("shape=cylinder3;");
    expect(serialized).toContain("fillColor=#fafafa;");
    expect(serialized).toContain("strokeColor=#d4d4d8;");
    expect(serialized).toContain("fontColor=#18181b;");
    expect(serialized).toContain("strokeWidth=1;");
  });
});

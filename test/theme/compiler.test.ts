import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileTheme } from "../../src/theme/compiler.js";
import { loadTheme } from "../../src/theme/loader.js";
import type { ThemeInput } from "../../src/theme/schema.js";

const shadcnModernPath = fileURLToPath(new URL("../../src/themes/shadcn-modern.yaml", import.meta.url));

function baseTheme(overrides: Partial<ThemeInput> = {}): ThemeInput {
  return {
    name: "test",
    version: 1,
    tokens: { border: "#e4e4e7", radius: 12 },
    defaults: {},
    rules: [],
    ...overrides,
  };
}

describe("compileTheme", () => {
  it("resolves $token references in defaults and rule styles", () => {
    const compiled = compileTheme(
      baseTheme({
        defaults: { fontFamily: "Inter" },
        rules: [{ selector: { kind: "node" }, style: { strokeColor: "$border", arcSize: "$radius" } }],
      }),
    );
    expect(compiled.defaults).toEqual({ fontFamily: "Inter" });
    expect(compiled.rules[0]?.style).toEqual({ strokeColor: "#e4e4e7", arcSize: "12" });
  });

  it("passes through literal (non-$) style values unchanged", () => {
    const compiled = compileTheme(
      baseTheme({ rules: [{ selector: { kind: "node" }, style: { fillColor: "#fafafa", rounded: 1 } }] }),
    );
    expect(compiled.rules[0]?.style).toEqual({ fillColor: "#fafafa", rounded: "1" });
  });

  it("coerces numeric style values to strings", () => {
    const compiled = compileTheme(baseTheme({ defaults: { fontSize: 14 } }));
    expect(compiled.defaults.fontSize).toBe("14");
  });

  it("throws a fatal error naming a missing token reference", () => {
    expect(() =>
      compileTheme(
        baseTheme({ rules: [{ selector: { kind: "node" }, style: { strokeColor: "$doesNotExist" } }] }),
      ),
    ).toThrow(/doesNotExist/);
  });

  it("throws a fatal error naming a forbidden (non-allow-listed) style property", () => {
    expect(() =>
      compileTheme(baseTheme({ rules: [{ selector: { kind: "node" }, style: { shape: "cylinder3" } }] })),
    ).toThrow(/shape/);
  });

  it("throws for other topology/geometry properties too (container, image)", () => {
    expect(() =>
      compileTheme(baseTheme({ rules: [{ selector: { kind: "node" }, style: { container: "1" } }] })),
    ).toThrow(/container/);
    expect(() =>
      compileTheme(baseTheme({ rules: [{ selector: { kind: "image" }, style: { image: "foo.png" } }] })),
    ).toThrow(/image/);
  });

  it("compiles the bundled shadcn-modern.yaml end-to-end with no dangling $refs", () => {
    const source = readFileSync(shadcnModernPath, "utf8");
    const compiled = compileTheme(loadTheme(source));

    expect(compiled.name).toBe("shadcn-modern");
    expect(compiled.rules.length).toBeGreaterThan(0);

    const allValues = [
      ...Object.values(compiled.defaults),
      ...compiled.rules.flatMap((rule) => Object.values(rule.style)),
    ];
    for (const value of allValues) {
      expect(value.startsWith("$")).toBe(false);
    }
  });
});

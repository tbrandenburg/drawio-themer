import { describe, expect, it } from "vitest";
import { ThemeSchema } from "../../src/theme/schema.js";

describe("ThemeSchema", () => {
  it("accepts a minimal valid theme", () => {
    const result = ThemeSchema.safeParse({
      name: "test",
      version: 1,
      tokens: { border: "#e4e4e7" },
      rules: [{ selector: { kind: "node" }, style: { fillColor: "$border" } }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults tokens/defaults/rules to empty when omitted", () => {
    const result = ThemeSchema.parse({ name: "test", version: 1 });
    expect(result.tokens).toEqual({});
    expect(result.defaults).toEqual({});
    expect(result.rules).toEqual([]);
  });

  it("defaults glow to false when omitted, and accepts an explicit true", () => {
    const withoutFlag = ThemeSchema.parse({ name: "test", version: 1 });
    expect(withoutFlag.glow).toBe(false);

    const withFlag = ThemeSchema.parse({ name: "test", version: 1, glow: true });
    expect(withFlag.glow).toBe(true);
  });

  it("accepts numeric token values", () => {
    const result = ThemeSchema.safeParse({
      name: "test",
      version: 1,
      tokens: { radius: 12 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a partial selector with any subset of fields", () => {
    const result = ThemeSchema.safeParse({
      name: "test",
      version: 1,
      rules: [
        { selector: { tag: "primary" }, style: {} },
        { selector: { role: "service" }, style: {} },
        { selector: { shape: "cylinder3" }, style: {} },
        { selector: {}, style: {} },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown kind value", () => {
    const result = ThemeSchema.safeParse({
      name: "test",
      version: 1,
      rules: [{ selector: { kind: "bogus" }, style: {} }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    const result = ThemeSchema.safeParse({ name: "test", version: 1, extra: true });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown selector key", () => {
    const result = ThemeSchema.safeParse({
      name: "test",
      version: 1,
      rules: [{ selector: { bogus: "x" }, style: {} }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required name/version", () => {
    expect(ThemeSchema.safeParse({}).success).toBe(false);
  });
});

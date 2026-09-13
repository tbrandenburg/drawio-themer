import { describe, expect, it } from "vitest";
import { loadTheme } from "../../src/theme/loader.js";

describe("loadTheme", () => {
  it("parses and validates a minimal theme", () => {
    const yaml = `
name: test-theme
version: 1
tokens:
  border: "#e4e4e7"
rules:
  - selector:
      kind: node
    style:
      strokeColor: "$border"
`;
    const theme = loadTheme(yaml);
    expect(theme.name).toBe("test-theme");
    expect(theme.tokens.border).toBe("#e4e4e7");
    expect(theme.rules).toHaveLength(1);
  });

  it("throws a fatal error with details on invalid YAML syntax", () => {
    const invalidYaml = "name: test\n  bad indentation: [unterminated";
    expect(() => loadTheme(invalidYaml)).toThrow(/Failed to parse theme YAML/);
  });

  it("throws a fatal error with Zod issue details on schema violation", () => {
    const yaml = `
version: 1
rules:
  - selector:
      kind: not-a-real-kind
    style: {}
`;
    expect(() => loadTheme(yaml)).toThrow(/Invalid theme schema/);
  });

  it("reports the missing 'name' field in the error message", () => {
    const yaml = `version: 1`;
    expect(() => loadTheme(yaml)).toThrow(/name/);
  });
});

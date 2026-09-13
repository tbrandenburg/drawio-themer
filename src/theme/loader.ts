/**
 * YAML theme file loader (PRD section 16 "Theme Resolution Pipeline",
 * Phase 5). Parses YAML text and validates it against `ThemeSchema`,
 * throwing a clear, fatal error on either a YAML syntax error or a
 * schema violation.
 */
import { parse as parseYaml } from "yaml";
import { ThemeSchema, type ThemeInput } from "./schema.js";

/**
 * Parses and validates a theme YAML document from its raw text content.
 *
 * @throws Error with a message including the YAML parse error, or every
 * Zod validation issue (path + message), on invalid input.
 */
export function loadTheme(source: string): ThemeInput {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse theme YAML: ${reason}`, { cause: error });
  }

  const result = ThemeSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid theme schema:\n${issues}`);
  }

  return result.data;
}

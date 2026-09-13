/**
 * Zod schema for human-authored theme YAML files (PRD section 12 "Theme
 * Format" / Phase 5).
 *
 * Deliberately permissive on `selector` (every field optional, matched as
 * a partial AND) and on `style` values (string or number - draw.io style
 * values are always strings, but numeric YAML like `rounded: 1` is
 * common and coerced downstream by the compiler). No allow-list/token
 * validation happens here - that is `src/theme/compiler.ts`'s job, since
 * it needs the resolved token table to check `$ref`s.
 */
import { z } from "zod";
import type { CellClass } from "../types.js";

const cellClassValues = [
  "node",
  "edge",
  "text",
  "container",
  "image",
  "database",
  "group",
] as const satisfies readonly CellClass[];

const TokenValueSchema = z.union([z.string(), z.number()]);

const StyleValueSchema = z.union([z.string(), z.number()]);

const SelectorSchema = z
  .object({
    kind: z.enum(cellClassValues),
    shape: z.string(),
    tag: z.string(),
    role: z.string(),
  })
  .partial()
  .strict();

const RuleSchema = z
  .object({
    selector: SelectorSchema,
    style: z.record(z.string(), StyleValueSchema),
  })
  .strict();

export const ThemeSchema = z
  .object({
    name: z.string(),
    version: z.number(),
    tokens: z.record(z.string(), TokenValueSchema).optional().default({}),
    defaults: z.record(z.string(), StyleValueSchema).optional().default({}),
    rules: z.array(RuleSchema).optional().default([]),
    /**
     * Preview-rendering hint only (issue #8 follow-up): whether the offline
     * `--png-themed` PNG preview should draw a soft glow filter around
     * edges/cylinders/container borders. Not a style token, not consumed by
     * the compiler/matcher/transform pipeline - purely cosmetic, and only
     * suits vibrant/neon-leaning dark themes (e.g. `dark-neon-mode`,
     * `dracula`, `monokai`); muted, light, retro, or accessibility-focused
     * themes should leave this `false` (the default).
     */
    previewGlow: z.boolean().optional().default(false),
  })
  .strict();

export type ThemeInput = z.infer<typeof ThemeSchema>;
export type ThemeRuleInput = z.infer<typeof RuleSchema>;
export type ThemeSelectorInput = z.infer<typeof SelectorSchema>;

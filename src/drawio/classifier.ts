/**
 * draw.io cell classifier (PRD section 11 "Classification" / Phase 4).
 *
 * Determines which internal classes an `<mxCell>` belongs to, plus any
 * semantic metadata tags exposed by an enclosing `<object>`/`<UserObject>`
 * wrapper. Pure DOM inspection + style-string parsing only - no mutation.
 */
import type { Element as XmlElement } from "@xmldom/xmldom";
import type { CellClass, CellClassification } from "../types.js";
import { parseStyle } from "./styles.js";

function hasToken(tokens: string[], token: string): boolean {
  return tokens.includes(token);
}

function propertyStartsWith(properties: Record<string, string>, key: string, prefix: string): boolean {
  return properties[key]?.startsWith(prefix) ?? false;
}

/**
 * Classifies a single `<mxCell>` element.
 *
 * `wrapper` is the optional enclosing `<object>`/`<UserObject>` element
 * (draw.io attaches semantic metadata there, e.g.
 * `<UserObject role="service" tags="backend critical"><mxCell .../></UserObject>`).
 *
 * Classes are returned in priority order per PRD Phase 4:
 * image > text > container > database > edge > node. A cell may match
 * several classes (e.g. an edge that is also styled as text); all
 * applicable classes are returned so later phases can match on any of
 * them, with the first entry treated as the "primary" classification.
 */
export function classifyCell(cell: XmlElement, wrapper?: XmlElement): CellClassification {
  const style = cell.getAttribute("style") ?? "";
  const { tokens, properties } = parseStyle(style);

  const isEdge = cell.getAttribute("edge") === "1";
  const isVertex = cell.getAttribute("vertex") === "1";

  const isImage =
    propertyStartsWith(properties, "shape", "image") ||
    "image" in properties ||
    hasToken(tokens, "image");

  const isText =
    hasToken(tokens, "text") ||
    // Conservative fallback: a vertex with no shape/fill/border styling at
    // all is treated as label-only text, per PRD "obvious label-only
    // styling". Deliberately simple - not an exhaustive shape check.
    (isVertex &&
      !("shape" in properties) &&
      !("fillColor" in properties) &&
      properties.strokeColor === "none" &&
      !isImage);

  const isContainer =
    hasToken(tokens, "swimlane") ||
    propertyStartsWith(properties, "shape", "swimlane") ||
    properties.container === "1";

  const isDatabase =
    propertyStartsWith(properties, "shape", "cylinder3") ||
    propertyStartsWith(properties, "shape", "cylinder");

  const classes: CellClass[] = [];
  if (isImage) classes.push("image");
  if (isText) classes.push("text");
  if (isContainer) classes.push("container");
  if (isDatabase) classes.push("database");
  if (isEdge) classes.push("edge");
  // Generic node fallback: a vertex not otherwise classified still
  // receives "node" so downstream matchers always have a class to target.
  if (isVertex && classes.length === 0) classes.push("node");

  const semanticTags: string[] = [];
  if (wrapper) {
    const role = wrapper.getAttribute("role");
    if (role) semanticTags.push(`role:${role}`);

    const tags = wrapper.getAttribute("tags");
    if (tags) {
      for (const tag of tags.split(/\s+/).filter((t) => t !== "")) {
        semanticTags.push(`tag:${tag}`);
      }
    }
  }

  return { classes, semanticTags };
}

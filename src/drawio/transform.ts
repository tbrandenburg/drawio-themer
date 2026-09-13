/**
 * Per-cell / per-page transformer (PRD section 17 "Diagram
 * Transformation Pipeline" / Phase 6).
 *
 * Wires together Phases 2-5: for every page's mxGraphModel, every
 * `<mxCell>` is classified, matched against the compiled theme's rules,
 * and re-styled - preserving every non-allow-listed style property and
 * all cell attributes (geometry, source/target, parent, etc).
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import { classifyCell } from "./classifier.js";
import { mergeStyle, parseStyle, serializeStyle } from "./styles.js";
import { matchRules } from "../theme/matcher.js";
import { getPages, loadDrawioDocument, serializeDrawioDocument } from "./document.js";
import type {
  CompiledTheme,
  OutputFormat,
  ParsedStyle,
  TransformResult,
  TransformStats,
  VerboseCellDetail,
} from "../types.js";

/** Cell classes tracked in per-run statistics (PRD section 25). */

function parseModelXml(xml: string): XmlElement {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  });
  const doc = parser.parseFromString(xml, "text/xml");
  if (errors.length > 0 || !doc.documentElement) {
    throw new Error(`Invalid mxGraphModel XML: ${errors[0] ?? "no root element"}`);
  }
  return doc.documentElement;
}

function findWrapper(cell: XmlElement): XmlElement | undefined {
  const parent = cell.parentNode as XmlNode | null;
  if (parent && parent.nodeType === 1) {
    const parentEl = parent as unknown as XmlElement;
    if (parentEl.nodeName === "object" || parentEl.nodeName === "UserObject") {
      return parentEl;
    }
  }
  return undefined;
}

function isInspectable(cell: XmlElement): boolean {
  return cell.getAttribute("vertex") === "1" || cell.getAttribute("edge") === "1";
}

function computeThemedStyle(
  theme: CompiledTheme,
  original: ParsedStyle,
  matched: { style: Record<string, string> }[],
): ParsedStyle {
  // Theme defaults are a baseline for cells the theme actually targets,
  // not a global stamp on every inspected cell (PRD section 25's stats
  // model expects "Cells skipped" to be a normal, non-zero outcome, e.g.
  // for plain text cells with no matching selector). If no rule matched,
  // leave the cell's style untouched entirely.
  if (matched.length === 0) return original;

  let desired: ParsedStyle = { tokens: [], properties: { ...theme.defaults } };
  for (const rule of matched) {
    desired = mergeStyle(desired, { properties: rule.style });
  }
  return mergeStyle(original, { properties: desired.properties });
}

function changedProperties(original: ParsedStyle, themed: ParsedStyle): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(themed.properties)) {
    if (original.properties[key] !== value) changed.push(key);
  }
  return changed;
}

function resolveForceCompressed(format: OutputFormat, originalCompressed: boolean): boolean {
  if (format === "compressed") return true;
  if (format === "uncompressed") return false;
  return originalCompressed;
}

export interface TransformOptions {
  format: OutputFormat;
  verbose: boolean;
  themeMetadata: boolean;
}

/**
 * Runs the full apply pipeline (PRD section 17) against a `.drawio`
 * document's raw XML text, producing the transformed output XML plus
 * statistics (PRD section 25) and, if `options.verbose`, per-cell detail.
 */
export function transformDrawioXml(
  inputXml: string,
  theme: CompiledTheme,
  options: TransformOptions,
): TransformResult {
  const doc = loadDrawioDocument(inputXml);
  const pages = getPages(doc);

  const stats: TransformStats = {
    themeName: theme.name,
    pages: pages.length,
    cellsInspected: 0,
    themedByClass: {},
    cellsSkipped: 0,
  };
  const verboseDetails: VerboseCellDetail[] = [];

  for (const page of pages) {
    const modelXml = page.getModelXml();
    const modelRoot = parseModelXml(modelXml);
    const cells = modelRoot.getElementsByTagName("mxCell");

    for (let i = 0; i < cells.length; i++) {
      const cell = cells.item(i);
      if (!cell || !isInspectable(cell)) continue;

      stats.cellsInspected += 1;

      const wrapper = findWrapper(cell);
      const classification = classifyCell(cell, wrapper);
      const matched = matchRules(classification, theme.rules);

      const originalStyleAttr = cell.getAttribute("style") ?? "";
      const original = parseStyle(originalStyleAttr);
      const themed = computeThemedStyle(theme, original, matched);
      const changed = changedProperties(original, themed);

      if (changed.length > 0) {
        cell.setAttribute("style", serializeStyle(themed));

        const primaryClass = classification.classes[0];
        if (primaryClass) {
          stats.themedByClass[primaryClass] = (stats.themedByClass[primaryClass] ?? 0) + 1;
        }

        if (options.verbose) {
          const label = cell.getAttribute("value") || cell.getAttribute("id") || "(unnamed)";
          verboseDetails.push({
            label,
            classes: classification.classes,
            semanticTags: classification.semanticTags,
            changedProperties: changed,
          });
        }
      } else {
        stats.cellsSkipped += 1;
      }
    }

    const serializedModel = new XMLSerializer().serializeToString(modelRoot);
    page.setModelXml(serializedModel, resolveForceCompressed(options.format, page.compressed));
  }

  if (options.themeMetadata) {
    doc.xmlDoc.documentElement?.setAttribute("drawio-themer", theme.name);
    doc.xmlDoc.documentElement?.setAttribute("drawio-themer-version", "1");
  }

  return { outputXml: serializeDrawioDocument(doc), stats, verboseDetails };
}

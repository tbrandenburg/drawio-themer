/**
 * Lightweight, offline `.drawio` -> SVG renderer (issue #5; SVG became a
 * first-class, user-facing output format in issue #9).
 *
 * TypeScript port of `scripts/render-drawio-preview.py`, built on top of
 * the document model the CLI already constructs (`loadDrawioDocument` /
 * `getPages`) instead of re-parsing the raw `.drawio` XML from scratch -
 * this guarantees the render reflects exactly the same page content
 * (inline or compressed) that the rest of the pipeline sees, rather than
 * a second, independent XML parse.
 *
 * NOT a replacement for draw.io's real renderer: no HTML labels, no true
 * font-metric-based text layout (wrapping/rotation/arrows are best-effort
 * approximations). It reads mxCell fill/stroke/font colors and basic
 * shapes (rect/ellipse/rhombus/hexagon/cylinder) and draws an
 * approximate SVG, good enough for a quick visual diff.
 */
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement } from "@xmldom/xmldom";
import sharp from "sharp";
import { getPages, loadDrawioDocument } from "../drawio/document.js";
import { parseStyle } from "../drawio/styles.js";

/**
 * The generated `.drawio` file's fontFamily (e.g. "Inter") is a valid,
 * bundled web font in real draw.io/diagrams.net, but an offline render
 * environment may have no such font installed. Rather than mutate the
 * theme's actual fontFamily token, append known-installed fallbacks here
 * so the render still uses a modern sans instead of the rasterizer's
 * serif default for an unrecognized font name.
 */
export const FONT_FALLBACK_STACK = "Noto Sans, Helvetica Neue, Arial, sans-serif";

// Mirrors mxgraph's mxConstants.LINE_HEIGHT: real draw.io spaces wrapped
// label lines at ~1.2x the cell's fontSize, not a fixed pixel constant
// (issue #47).
const LINE_HEIGHT_FACTOR = 1.2;

/** Whether to draw a soft glow behind nodes/edges using a real SVG `<filter>`. */
export type GlowMode = "none" | "filter";

export interface RenderOptions {
  /** Background fill color for the canvas. Defaults to `#ffffff`. */
  background?: string;
  /** Glow rendering mode (feGaussianBlur + gradients). Defaults to `"none"`. */
  glow?: GlowMode;
  /**
   * Canvas width in px. Defaults to 850 only when the document's
   * `<mxGraphModel pageWidth>` is absent; otherwise the canvas auto-fits
   * the diagram's real page size (see `renderDrawioToSvg`).
   */
  width?: number;
  /**
   * Canvas height in px. Defaults to 700 only when the document's
   * `<mxGraphModel pageHeight>` is absent; otherwise the canvas auto-fits
   * the diagram's real page size (see `renderDrawioToSvg`).
   */
  height?: number;
}

interface NodeGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The node's perimeter shape kind, used by `connectionPoint` to clip
   * edge endpoints to the shape's real border instead of always using a
   * rectangular bounding-box clip (issue #35). Edge label cells (added in
   * a second pass, see `edgeLabelCells`) have no real shape and default
   * to `"rect"`, matching the previous behavior for them.
   */
  shape: PerimeterShape;
}

/**
 * Derives a node's `PerimeterShape` from its parsed style, matching the
 * same shape-detection tokens used by the node-rendering loop below
 * (`isEllipse`/`isRhombus`/`isHexagon`).
 */
function perimeterShapeOf(style: ReturnType<typeof parseStyle>): PerimeterShape {
  const shape = style.properties.shape ?? "";
  if (shape === "ellipse" || style.tokens.includes("ellipse")) return "ellipse";
  if (shape === "rhombus" || style.tokens.includes("rhombus")) return "rhombus";
  if (shape === "hexagon") return "hexagon";
  return "rect";
}

function childElements(parent: XmlElement, tagName: string): XmlElement[] {
  const result: XmlElement[] = [];
  const nodes = parent.getElementsByTagName(tagName);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (node) result.push(node as unknown as XmlElement);
  }
  return result;
}

function numAttr(el: XmlElement, name: string, fallback = 0): number {
  const value = el.getAttribute(name);
  if (value === null || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function lighten(hexColor: string, amount = 14): string {
  const h = hexColor.replace(/^#/, "");
  if (h.length !== 6) return hexColor;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  const clamp = (c: number) => Math.min(255, c + amount);
  return `#${[r, g, b]
    .map(clamp)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Clips the point at the rect's edge along the line from (cx,cy) [this
 * rect's center] toward (ox,oy) [the other endpoint], so edges terminate
 * on the node's border instead of its center.
 */
function clipToRect(
  cx: number,
  cy: number,
  ox: number,
  oy: number,
  rw: number,
  rh: number,
): [number, number] {
  const dx = ox - cx;
  const dy = oy - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = rw / 2;
  const hh = rh / 2;
  const scale = Math.min(
    dx !== 0 ? Math.abs(hw / dx) : Infinity,
    dy !== 0 ? Math.abs(hh / dy) : Infinity,
  );
  return [cx + dx * scale, cy + dy * scale];
}

/**
 * Perimeter shape kinds this renderer can clip an edge endpoint to,
 * mirroring mxgraph's `mxPerimeter` functions (`EllipsePerimeter`,
 * `RhombusPerimeter`, `HexagonPerimeter`) instead of only ever using a
 * rectangular bounding-box clip (issue #35). `"rect"` (and anything not
 * otherwise recognized) keeps the existing `clipToRect` behavior.
 */
type PerimeterShape = "rect" | "ellipse" | "rhombus" | "hexagon";

/**
 * Clips the point at the ellipse's boundary along the line from (cx,cy)
 * [the ellipse's center] toward (ox,oy), matching mxgraph's
 * `mxPerimeter.EllipsePerimeter`: parametrize the ray as `(cx + dx*t, cy +
 * dy*t)` and solve for the `t > 0` where `((dx*t)/a)^2 + ((dy*t)/b)^2 = 1`.
 */
function clipToEllipse(
  cx: number,
  cy: number,
  ox: number,
  oy: number,
  rw: number,
  rh: number,
): [number, number] {
  const dx = ox - cx;
  const dy = oy - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const a = rw / 2;
  const b = rh / 2;
  if (a === 0 || b === 0) return [cx, cy];
  const denom = (dx / a) ** 2 + (dy / b) ** 2;
  const t = 1 / Math.sqrt(denom);
  return [cx + dx * t, cy + dy * t];
}

/**
 * Intersects the ray from (cx,cy) toward (ox,oy) with whichever edge of
 * the given closed polygon it crosses first, returning that intersection
 * point. Falls back to (cx,cy) if no edge intersects (degenerate/self-
 * intersecting polygon), which should not happen for the convex
 * rhombus/hexagon outlines this renderer builds. Shared by
 * `clipToRhombus` and `clipToHexagon` (both mxgraph perimeter functions
 * boil down to "ray vs polygon edges" for a convex outline).
 */
function clipToPolygon(
  cx: number,
  cy: number,
  ox: number,
  oy: number,
  points: Array<[number, number]>,
): [number, number] {
  const dx = ox - cx;
  const dy = oy - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[(i + 1) % points.length]!;
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dx * ey - dy * ex;
    if (denom === 0) continue; // parallel to this edge
    // Solve cx + dx*t = ax + ex*s ; cy + dy*t = ay + ey*s for t (ray param)
    // and s (edge param, must be in [0,1] to lie on the segment).
    const t = ((ax - cx) * ey - (ay - cy) * ex) / denom;
    const s = ((ax - cx) * dy - (ay - cy) * dx) / denom;
    if (t >= 0 && s >= 0 && s <= 1) {
      return [cx + dx * t, cy + dy * t];
    }
  }
  return [cx, cy];
}

/** The rhombus (diamond) outline mxgraph draws for `rhombus`-shaped cells. */
function rhombusPoints(x: number, y: number, w: number, h: number): Array<[number, number]> {
  return [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
  ];
}

/** The hexagon outline this renderer draws for `shape=hexagon` cells (25% inset). */
function hexagonPoints(x: number, y: number, w: number, h: number): Array<[number, number]> {
  const inset = w * 0.25;
  return [
    [x + inset, y],
    [x + w - inset, y],
    [x + w, y + h / 2],
    [x + w - inset, y + h],
    [x + inset, y + h],
    [x, y + h / 2],
  ];
}

/**
 * Clips an edge endpoint to a node's real perimeter (ellipse/rhombus/
 * hexagon), falling back to `clipToRect` for `"rect"` or any unhandled
 * shape (issue #35: `mxPerimeter.js`-equivalent perimeter math, replacing
 * the previous bounding-box-only approximation).
 */
function clipToShape(
  shape: PerimeterShape,
  cx: number,
  cy: number,
  ox: number,
  oy: number,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  switch (shape) {
    case "ellipse":
      return clipToEllipse(cx, cy, ox, oy, w, h);
    case "rhombus":
      return clipToPolygon(cx, cy, ox, oy, rhombusPoints(x, y, w, h));
    case "hexagon":
      return clipToPolygon(cx, cy, ox, oy, hexagonPoints(x, y, w, h));
    default:
      return clipToRect(cx, cy, ox, oy, w, h);
  }
}

/** Builds a `<polygon points="...">` string from a flat array of [x,y] pairs. */
function polygonPoints(points: Array<[number, number]>): string {
  return points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Approximates draw.io's `whiteSpace=wrap` behavior: greedily wraps each
 * existing line of `label` onto multiple lines so it fits within `width`,
 * using a rough average character width (no real font metrics available
 * offline). Words longer than a whole line are kept intact rather than
 * split mid-word.
 */
/**
 * Coarse per-character-class average width (as a multiple of font size),
 * distinguishing narrow/average/wide glyphs - a real font-metric table is
 * unavailable offline, but even this rough split is meaningfully more
 * accurate than a single flat `size * 0.6` constant for every character
 * (issue #30: that flat estimate misjudged an already-fitting,
 * explicitly-authored line as overflowing by a single character).
 */
const NARROW_CHARS = /[iIl.,:;'"!|]/;
const WIDE_CHARS = /[mwMW@%]/;

// Bold glyphs render measurably wider than regular weight at the same
// font size (issue #37); widen the flat per-character estimate by this
// factor when the label is bold so labels near the wrap threshold don't
// overflow their box.
const BOLD_WIDTH_MULTIPLIER = 1.15;

function estimateTextWidth(text: string, size: number, bold = false): number {
  let width = 0;
  for (const ch of text) {
    if (NARROW_CHARS.test(ch)) width += size * 0.3;
    else if (WIDE_CHARS.test(ch)) width += size * 0.8;
    else width += size * 0.5;
  }
  return bold ? width * BOLD_WIDTH_MULTIPLIER : width;
}

function wrapLabel(label: string, width: number, fontSize: string, bold = false): string[] {
  const size = Number.parseFloat(fontSize) || 12;

  const wrapped: string[] = [];
  for (const paragraph of label.split("\n")) {
    // Explicit, author-authored line breaks are hard breaks: only
    // re-wrap this paragraph if it actually overflows the available
    // width on its own (issue #30).
    if (estimateTextWidth(paragraph, size, bold) <= width) {
      wrapped.push(paragraph);
      continue;
    }

    // Tokenize each word further at internal hyphens (keeping the hyphen
    // attached to the preceding fragment), so a single space-free
    // hyphenated compound like "Human-On-The-Loop" still offers soft-wrap
    // points, matching real draw.io's text layout (issue #41).
    const tokens: { text: string; spaceBefore: boolean }[] = [];
    for (const word of paragraph.split(" ")) {
      const parts = word.split(/(?<=-)/);
      parts.forEach((part, idx) => tokens.push({ text: part, spaceBefore: idx === 0 }));
    }

    let current = "";
    for (const token of tokens) {
      const separator = token.spaceBefore && current ? " " : "";
      const candidate = `${current}${separator}${token.text}`;
      if (estimateTextWidth(candidate, size, bold) > width && current) {
        wrapped.push(current);
        current = token.text;
      } else {
        current = candidate;
      }
    }
    wrapped.push(current);
  }
  return wrapped;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** One line of an `html=1` label, with an optional per-line bold/italic
 * override relative to the cell's own `fontStyle` baseline (issue #38). */
interface HtmlLabelLine {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

// Matches a line whose *entire* content is wrapped in a single
// `<span style="...">...</span>` - the line-level-only scope this issue
// asks for (partial-line/mid-line multi-run spans are explicitly out of
// scope, see issue #38's "Proposed fix").
const FULL_LINE_SPAN = /^<span\s+style="([^"]*)"\s*>([\s\S]*)<\/span>$/i;

/**
 * A label with `html=1` in its style stores real (draw.io-editor-authored)
 * HTML markup as its `value` (e.g. `Line 1<br>Line 2`, `<div>...</div>`,
 * `&amp;`) rather than plain text - draw.io's own renderer feeds this
 * straight into a `foreignObject`/DOM node. This renderer has no HTML
 * layout engine, so instead: split on block-ish/line-break tags, strip
 * every other tag, and decode the handful of entities draw.io commonly
 * emits, so at least the plain text content shows up instead of raw
 * `<br>`/`&nbsp;` (issue #17).
 *
 * A line entirely wrapped in a single `<span style="font-weight: ...">`
 * and/or `font-style: ...` (e.g. a regular-weight subtitle under a bold
 * heading) overrides the cell-level bold/italic for that line only
 * (issue #38) - the span tags themselves are stripped from the visible
 * text.
 */
function parseHtmlLabelLines(html: string): HtmlLabelLine[] {
  const rawLines = html
    .replace(/<br\s*\/?>/gi, "\u0000")
    .replace(/<\/(div|p|li)>/gi, "\u0000")
    .replace(/\n/g, "\u0000")
    .split("\u0000");

  const lines: HtmlLabelLine[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    const spanMatch = FULL_LINE_SPAN.exec(trimmed);
    let bold: boolean | undefined;
    let italic: boolean | undefined;
    const content = spanMatch ? (spanMatch[2] ?? "") : trimmed;
    if (spanMatch) {
      const spanStyle = spanMatch[1] ?? "";
      const boldMatch = /font-weight\s*:\s*(normal|bold)/i.exec(spanStyle);
      if (boldMatch) bold = (boldMatch[1] ?? "").toLowerCase() === "bold";
      const italicMatch = /font-style\s*:\s*(normal|italic)/i.exec(spanStyle);
      if (italicMatch) italic = (italicMatch[1] ?? "").toLowerCase() === "italic";
    }

    const text = decodeHtmlEntities(content.replace(/<[^>]+>/g, "")).trim();
    if (text === "" && rawLines.length > 1) continue;
    lines.push({ text, bold, italic });
  }
  return lines.length > 0 ? lines : [{ text: "" }];
}

/**
 * draw.io stores embedded images as `image=data:image/png,<base64>` -
 * deliberately omitting the RFC 2397 `;base64,` marker, since the style
 * string itself uses `;` as its property delimiter (real draw.io's own
 * renderer re-inserts it before setting an `<img>` src). An SVG
 * `<image>` href needs the RFC-compliant form to actually decode as a
 * raster image - without this, resvg silently renders nothing instead
 * of erroring, which looked like a "blank icon" bug rather than a
 * malformed-URI one.
 */
function normalizeDataUri(uri: string): string {
  const match = /^data:([^,;]+),(.*)$/s.exec(uri);
  if (!match) return uri;
  const [, mime, payload] = match;
  return `data:${mime};base64,${payload}`;
}

/**
 * Matches an embedded `image=data:image/webp...` data URI in a `.drawio`
 * style string, in both forms draw.io can produce: the base64-marker-
 * omitting `data:image/webp,<base64>` (see `normalizeDataUri`'s doc
 * comment) and the RFC-compliant `data:image/webp;base64,<base64>`. The
 * base64 payload alphabet never contains XML-significant characters
 * (`&`, `<`, `>`, `"`, `'`), so it is safe to match directly against the
 * raw, not-yet-parsed `.drawio` XML text.
 */
const WEBP_DATA_URI_RE = /data:image\/webp(?:;base64)?,([A-Za-z0-9+/=]+)/g;

/**
 * resvg (via `@resvg/resvg-js`) has no `image/webp` decoder: a `<image>`
 * href pointing at a webp data URI doesn't just fail to render its own
 * icon, it blanks out the entire raster region resvg was drawing,
 * silently dropping the surrounding `<rect>`/`<text>` too (issue #21).
 * This scans the raw `.drawio` XML for embedded webp images *before* SVG
 * generation and re-encodes each one as PNG via `sharp`, so by the time
 * `renderDrawioToSvg` builds the `<image>` element it is already a
 * codec resvg supports. Conversion failures fall back to leaving the
 * original (still-broken-in-resvg, but unchanged) data URI in place
 * rather than throwing, so a single malformed icon doesn't fail the
 * whole render.
 */
export async function convertWebpImagesToPng(drawioXml: string): Promise<string> {
  const matches = [...drawioXml.matchAll(WEBP_DATA_URI_RE)];
  if (matches.length === 0) return drawioXml;

  const replacements = new Map<string, string>();
  for (const match of matches) {
    const [fullMatch, payload] = match;
    if (!payload || replacements.has(fullMatch)) continue;
    try {
      const webpBuffer = Buffer.from(payload, "base64");
      const pngBuffer = await sharp(webpBuffer).png().toBuffer();
      // Mirror draw.io's own storage convention (see `normalizeDataUri`'s
      // doc comment): omit the ";base64," marker here too, since this
      // replacement lands back inside a `;`-delimited style string -
      // `normalizeDataUri` re-inserts the marker later, once the value
      // has been safely extracted from the style string.
      replacements.set(fullMatch, `data:image/png,${pngBuffer.toString("base64")}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Could not convert embedded webp image to PNG, leaving as-is: ${reason}`);
    }
  }
  if (replacements.size === 0) return drawioXml;

  let result = drawioXml;
  for (const [original, replacement] of replacements) {
    result = result.split(original).join(replacement);
  }
  return result;
}

/**
 * Renders the first page of a `.drawio` document as an approximate SVG,
 * reusing the document model (handles both inline and compressed page
 * content transparently).
 */
/**
 * Renders a single page's `<mxGraphModel>` XML into SVG node/edge markup,
 * plus the page's natural (unscaled) width/height. All coordinates are
 * relative to this page's own origin; the caller (`renderDrawioToSvg`)
 * is responsible for translating/stacking multiple pages.
 */
function renderPage(
  modelXml: string,
  glow: GlowMode,
  defs: string[],
  gradientIds: Map<string, string>,
): { nodeSvg: string[]; edgeSvg: string[]; width: number; height: number } {
  const modelDoc = new DOMParser().parseFromString(modelXml, "text/xml");
  const root = modelDoc.documentElement as unknown as XmlElement;
  const cells = childElements(root, "mxCell");
  const cellById = new Map<string, XmlElement>();
  for (const cell of cells) {
    const id = cell.getAttribute("id");
    if (id) cellById.set(id, cell);
  }

  /**
   * A cell with `visible="0"` must not be drawn at all, and a descendant
   * of a `collapsed="1"` container/group must not be drawn either (real
   * draw.io hides a collapsed container's children until it is expanded).
   * The container/group cell itself still renders when collapsed - only
   * its descendants are suppressed.
   */
  const hiddenCache = new Map<string, boolean>();
  function isHidden(cellId: string, seen = new Set<string>()): boolean {
    const cached = hiddenCache.get(cellId);
    if (cached !== undefined) return cached;
    const cell = cellById.get(cellId);
    if (!cell || seen.has(cellId)) return false;
    seen.add(cellId);
    if (cell.getAttribute("visible") === "0") {
      hiddenCache.set(cellId, true);
      return true;
    }
    const parentId = cell.getAttribute("parent");
    if (!parentId) {
      hiddenCache.set(cellId, false);
      return false;
    }
    const parentCell = cellById.get(parentId);
    const parentCollapsed =
      !!parentCell &&
      parseStyle(parentCell.getAttribute("style") ?? "").properties.collapsed === "1";
    const hidden = parentCollapsed || isHidden(parentId, seen);
    hiddenCache.set(cellId, hidden);
    return hidden;
  }

  function gradientFor(fill: string): string {
    const existing = gradientIds.get(fill);
    if (existing) return existing;
    const gid = `grad${gradientIds.size}`;
    gradientIds.set(fill, gid);
    defs.push(
      `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${lighten(fill, 14)}"/>` +
        `<stop offset="1" stop-color="${fill}"/>` +
        "</linearGradient>",
    );
    return gid;
  }

  /**
   * A child cell's `<mxGeometry x y>` is relative to its parent cell (e.g.
   * a swimlane/container), not the page, in draw.io's format. Walk up the
   * `parent` chain and accumulate each ancestor's own absolute offset so
   * nested nodes land at their real page position instead of being drawn
   * relative to the page origin (the "clubbed" bug: children of a
   * container all stacking near (0,0)). Root cells "0"/"1" have no
   * geometry and terminate the walk. A `Set` guards against a malformed
   * file with a parent cycle.
   */
  const absoluteOffsetCache = new Map<string, { x: number; y: number }>();
  function absoluteOffset(cellId: string, seen = new Set<string>()): { x: number; y: number } {
    const cached = absoluteOffsetCache.get(cellId);
    if (cached) return cached;
    const cell = cellById.get(cellId);
    const parentId = cell?.getAttribute("parent");
    if (!cell || !parentId || seen.has(cellId)) return { x: 0, y: 0 };
    seen.add(cellId);
    const parentGeoNodes = childElements(cell, "mxGeometry");
    const ownGeo = parentGeoNodes[0];
    const parentBase = absoluteOffset(parentId, seen);
    const offset = ownGeo
      ? { x: parentBase.x + numAttr(ownGeo, "x"), y: parentBase.y + numAttr(ownGeo, "y") }
      : parentBase;
    absoluteOffsetCache.set(cellId, offset);
    return offset;
  }

  /**
   * A vertex whose `parent` is an edge cell (a floating edge label, e.g.
   * `relative="1"` geometry) can't be positioned in this pass: its
   * geometry's `x` is a fractional position along the edge's resolved
   * path (not a pixel offset), and that path depends on connection
   * points/waypoints computed later. Defer these to `edgeLabelCells` and
   * resolve them in a second pass, once `edgePathById` is known below.
   */
  const edgeLabelCells: XmlElement[] = [];
  const nodeGeo = new Map<string, NodeGeometry>();
  for (const cell of cells) {
    if (cell.getAttribute("vertex") !== "1") continue;
    const id = cell.getAttribute("id");
    const geoNodes = childElements(cell, "mxGeometry");
    const geo = geoNodes[0];
    if (!id || !geo) continue;
    const parentId = cell.getAttribute("parent");
    const parentCell = parentId ? cellById.get(parentId) : undefined;
    if (parentCell?.getAttribute("edge") === "1") {
      edgeLabelCells.push(cell);
      continue;
    }
    const parentOffset = parentId ? absoluteOffset(parentId) : { x: 0, y: 0 };
    nodeGeo.set(id, {
      x: parentOffset.x + numAttr(geo, "x"),
      y: parentOffset.y + numAttr(geo, "y"),
      w: numAttr(geo, "width"),
      h: numAttr(geo, "height"),
      shape: perimeterShapeOf(parseStyle(cell.getAttribute("style") ?? "")),
    });
  }

  function center(id: string | null): [number, number] | null {
    if (!id) return null;
    const geo = nodeGeo.get(id);
    return geo ? [geo.x + geo.w / 2, geo.y + geo.h / 2] : null;
  }

  /**
   * Resolves a node's connection point for an edge endpoint: if the edge
   * style specifies a fixed fractional connection point (`exitX/exitY` on
   * the source, `entryX/entryY` on the target), that fraction of the
   * node's border is used verbatim (matching real draw.io's fixed
   * connection points); otherwise falls back to `clipToRect`, projecting
   * from the node's center toward the other endpoint.
   */
  function connectionPoint(
    geo: NodeGeometry,
    fracX: string | undefined,
    fracY: string | undefined,
    otherX: number,
    otherY: number,
  ): [number, number] {
    if (fracX !== undefined && fracY !== undefined) {
      const fx = Number.parseFloat(fracX);
      const fy = Number.parseFloat(fracY);
      if (!Number.isNaN(fx) && !Number.isNaN(fy)) {
        return [geo.x + geo.w * fx, geo.y + geo.h * fy];
      }
    }
    const cx = geo.x + geo.w / 2;
    const cy = geo.y + geo.h / 2;
    return clipToShape(geo.shape, cx, cy, otherX, otherY, geo.x, geo.y, geo.w, geo.h);
  }

  /** The four cardinal sides a connection point can sit on, used by
   * `orthogonalRoute` to decide whether an edge's first/last segment
   * runs horizontally or vertically. */
  type Side = "N" | "S" | "E" | "W";

  /**
   * Derives a cardinal `Side` from a fixed fractional connection point
   * (`exitX/exitY` or `entryX/entryY`), matching draw.io's convention
   * that one axis sits at an extreme (`0` or `1`) while the other is
   * free (typically `0.5`). Returns `undefined` when the fractions are
   * missing, unparseable, or don't clearly identify a side (e.g. a
   * point on a corner), so callers can fall back to position-based
   * inference.
   */
  function sideFromFraction(
    fracX: string | undefined,
    fracY: string | undefined,
  ): Side | undefined {
    if (fracX === undefined || fracY === undefined) return undefined;
    const fx = Number.parseFloat(fracX);
    const fy = Number.parseFloat(fracY);
    if (Number.isNaN(fx) || Number.isNaN(fy)) return undefined;
    if (fx <= 0.001) return "W";
    if (fx >= 0.999) return "E";
    if (fy <= 0.001) return "N";
    if (fy >= 0.999) return "S";
    return undefined;
  }

  /**
   * Falls back to inferring a side from the relative position of two
   * points (mirrors mxgraph's own fallback when no fixed connection
   * point is set): picks the axis with the larger displacement and the
   * side that direction points toward.
   */
  function inferSide(from: [number, number], to: [number, number]): Side {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
    return dy >= 0 ? "S" : "N";
  }

  /**
   * Bounded orthogonal (elbow) router used for
   * `edgeStyle=orthogonalEdgeStyle`/`elbowEdgeStyle` edges that have no
   * explicit waypoints (issue #48). Produces a 2-3 segment,
   * horizontal/vertical-only path between `p1` and `p2`: a "Z" shape
   * whose first segment leaves `p1` on `exitSide`'s axis (horizontal
   * for E/W, vertical for N/S), through a midpoint, into `p2`. This is
   * intentionally not a full port of mxgraph's `OrthConnector`
   * (no obstacle avoidance, no jetty stubs) — see AGENTS.md's
   * "structural fidelity limits" note.
   */
  function orthogonalRoute(
    p1: [number, number],
    exitSide: Side,
    p2: [number, number],
  ): Array<[number, number]> {
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    // Already axis-aligned: a single straight segment is already
    // perpendicular/orthogonal, no elbow needed.
    if (x1 === x2 || y1 === y2) return [p1, p2];
    const points: Array<[number, number]> =
      exitSide === "E" || exitSide === "W"
        ? [
            [x1, y1],
            [(x1 + x2) / 2, y1],
            [(x1 + x2) / 2, y2],
            [x2, y2],
          ]
        : [
            [x1, y1],
            [x1, (y1 + y2) / 2],
            [x2, (y1 + y2) / 2],
            [x2, y2],
          ];
    // Drop consecutive duplicate points (e.g. when p1/p2 already share
    // the midpoint's coordinate), which would otherwise render as
    // zero-length segments.
    return points.filter(
      (pt, i) => i === 0 || pt[0] !== points[i - 1]![0] || pt[1] !== points[i - 1]![1],
    );
  }

  /**
   * Resolves an edge cell's actual rendered path (source connection point,
   * any explicit waypoints, target connection point), in the same way the
   * edge-rendering loop below draws it. Extracted so it can also be used
   * to position edge-label child cells (vertices whose `parent` is this
   * edge) before those labels are added to `nodeGeo`.
   */
  function computeEdgePath(cell: XmlElement): Array<[number, number]> | null {
    const style = parseStyle(cell.getAttribute("style") ?? "");
    const src = cell.getAttribute("source");
    const tgt = cell.getAttribute("target");
    const c1 = center(src);
    const c2 = center(tgt);
    if (!c1 || !c2 || !src || !tgt) return null;
    const sourceGeo = nodeGeo.get(src);
    const targetGeo = nodeGeo.get(tgt);
    if (!sourceGeo || !targetGeo) return null;

    const edgeGeoNodes = childElements(cell, "mxGeometry");
    const edgeGeo = edgeGeoNodes[0];
    const waypoints: Array<[number, number]> = [];
    if (edgeGeo) {
      const arrays = childElements(edgeGeo, "Array");
      const pointsArray = arrays.find((a) => a.getAttribute("as") === "points") ?? arrays[0];
      if (pointsArray) {
        for (const pt of childElements(pointsArray, "mxPoint")) {
          waypoints.push([numAttr(pt, "x"), numAttr(pt, "y")]);
        }
      }
    }

    const towardFromSource = waypoints[0] ?? c2;
    const towardFromTarget = waypoints[waypoints.length - 1] ?? c1;

    const [p1x, p1y] = connectionPoint(
      sourceGeo,
      style.properties.exitX,
      style.properties.exitY,
      towardFromSource[0],
      towardFromSource[1],
    );
    const [p2x, p2y] = connectionPoint(
      targetGeo,
      style.properties.entryX,
      style.properties.entryY,
      towardFromTarget[0],
      towardFromTarget[1],
    );

    const edgeStyle = style.properties.edgeStyle;
    const isOrthogonal = edgeStyle === "orthogonalEdgeStyle" || edgeStyle === "elbowEdgeStyle";
    if (isOrthogonal && waypoints.length === 0) {
      const exitSide =
        sideFromFraction(style.properties.exitX, style.properties.exitY) ?? inferSide(c1, c2);
      return orthogonalRoute([p1x, p1y], exitSide, [p2x, p2y]);
    }

    return [[p1x, p1y], ...waypoints, [p2x, p2y]];
  }

  const edgePathById = new Map<string, Array<[number, number]>>();
  for (const cell of cells) {
    if (cell.getAttribute("edge") !== "1") continue;
    const id = cell.getAttribute("id");
    if (!id) continue;
    const path = computeEdgePath(cell);
    if (path) edgePathById.set(id, path);
  }

  /**
   * Interpolates a point at arc-length fraction `t` (`0` = path start, `1`
   * = path end) along a polyline. Matches real draw.io's edge-label
   * geometry convention: the label's fractional `x` (`[-1, 1]`, `0` =
   * midpoint) maps to `t = (x + 1) / 2` along the edge's actual resolved
   * path (including waypoints/fixed connection points), not a straight
   * line between the two node centers.
   */
  function pointAlongPath(points: Array<[number, number]>, t: number): [number, number] {
    if (points.length === 0) return [0, 0];
    if (points.length === 1) return points[0]!;
    const segmentLengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const length = Math.hypot(bx - ax, by - ay);
      segmentLengths.push(length);
      total += length;
    }
    const clampedT = Math.min(1, Math.max(0, t));
    if (total === 0) return points[0]!;
    let target = clampedT * total;
    for (let i = 0; i < segmentLengths.length; i++) {
      const length = segmentLengths[i]!;
      if (target <= length || i === segmentLengths.length - 1) {
        const ratio = length === 0 ? 0 : target / length;
        const [ax, ay] = points[i]!;
        const [bx, by] = points[i + 1]!;
        return [ax + (bx - ax) * ratio, ay + (by - ay) * ratio];
      }
      target -= length;
    }
    return points[points.length - 1]!;
  }

  /**
   * Second nodeGeo pass: floating edge labels (`relative="1"` vertex
   * children of an edge cell) can only be positioned now that every
   * edge's resolved path is known. Per draw.io's convention, the
   * geometry's `x` (default 0) is a fractional position along the path
   * in `[-1, 1]`, and a nested `<mxPoint as="offset">` (default `{0,0}`)
   * is a pixel offset added after interpolation.
   */
  for (const cell of edgeLabelCells) {
    const id = cell.getAttribute("id");
    const parentId = cell.getAttribute("parent");
    const geoNodes = childElements(cell, "mxGeometry");
    const geo = geoNodes[0];
    if (!id || !parentId || !geo) continue;
    const path = edgePathById.get(parentId);
    if (!path) continue;

    const fraction = numAttr(geo, "x", 0);
    const t = (fraction + 1) / 2;
    const [px, py] = pointAlongPath(path, t);

    const offsetNodes = childElements(geo, "mxPoint").filter(
      (pt) => pt.getAttribute("as") === "offset",
    );
    const offset = offsetNodes[0];
    const dx = offset ? numAttr(offset, "x", 0) : 0;
    const dy = offset ? numAttr(offset, "y", 0) : 0;
    const w = numAttr(geo, "width", 0);
    const h = numAttr(geo, "height", 0);

    nodeGeo.set(id, {
      x: px + dx - w / 2,
      y: py + dy - h / 2,
      w,
      h,
      shape: "rect",
    });
  }

  /**
   * draw.io allows node geometry with negative x/y (content placed left of
   * or above the page origin), but this renderer's canvas always starts
   * at (0,0) with a hardcoded `viewBox="0 0 w h"` - anything at a
   * negative coordinate got silently clipped off-canvas (issue #15).
   * Rather than compute a negative-origin viewBox (which would also
   * require shifting every marker/gradient/background rect), shift every
   * node's absolute geometry so the leftmost/topmost content lands at 0,
   * preserving all relative positions and topology.
   */
  let minX = 0;
  let minY = 0;
  for (const geo of nodeGeo.values()) {
    minX = Math.min(minX, geo.x);
    minY = Math.min(minY, geo.y);
  }
  if (minX < 0 || minY < 0) {
    for (const geo of nodeGeo.values()) {
      geo.x -= minX;
      geo.y -= minY;
    }
    // edgePathById was built from the pre-shift nodeGeo; shift its points
    // too so the edge-rendering loop below (which reuses this map instead
    // of recomputing) draws in the same shifted coordinate space as the
    // now-shifted nodes.
    for (const [id, path] of edgePathById) {
      edgePathById.set(
        id,
        path.map(([px, py]) => [px - minX, py - minY]),
      );
    }
  }

  /** Builds a `stroke-dasharray` attribute fragment for a dashed/dotted style, or "" when solid. */
  function dashArrayAttr(style: ReturnType<typeof parseStyle>): string {
    if (style.properties.dashed !== "1") return "";
    const pattern = style.properties.dashPattern;
    const dashArray = pattern ? pattern.trim().split(/\s+/).join(",") : "4,4";
    return ` stroke-dasharray="${dashArray}"`;
  }

  /**
   * draw.io's `opacity`/`fillOpacity`/`strokeOpacity` style properties are
   * 0-100 integers; `opacity` is an overall multiplier applied to both
   * fill and stroke unless the more specific property is also set.
   */
  function opacities(style: ReturnType<typeof parseStyle>): { fill: number; stroke: number } {
    const overall = style.properties.opacity;
    const fillPct = style.properties.fillOpacity ?? overall ?? "100";
    const strokePct = style.properties.strokeOpacity ?? overall ?? "100";
    const toRatio = (pct: string) => {
      const parsed = Number.parseFloat(pct);
      return Number.isNaN(parsed) ? 1 : parsed / 100;
    };
    return { fill: toRatio(fillPct), stroke: toRatio(strokePct) };
  }

  /**
   * Maps a draw.io `startArrow`/`endArrow` style value to the matching
   * marker id defined in `renderDrawioToSvg`'s `<defs>`, or `undefined`
   * when the edge explicitly has no arrowhead at that end (`none`).
   * `endArrow` defaults to a classic arrowhead when unset (matching real
   * draw.io); `startArrow` defaults to no arrowhead when unset.
   */
  function arrowMarkerId(kind: string | undefined, end: "start" | "end"): string | undefined {
    const resolved = kind ?? (end === "end" ? "classic" : "none");
    if (resolved === "none") return undefined;
    const suffix = end === "start" ? "Start" : "";
    if (resolved.startsWith("diamond")) return `diamond${suffix}`;
    if (resolved === "oval") return `oval${suffix}`;
    return `arrow${suffix}`;
  }

  const edgeSvg: string[] = [];
  for (const cell of cells) {
    if (cell.getAttribute("edge") !== "1") continue;
    const edgeId = cell.getAttribute("id");
    if (edgeId && isHidden(edgeId)) continue;
    const style = parseStyle(cell.getAttribute("style") ?? "");
    const allPoints = edgeId ? edgePathById.get(edgeId) : undefined;
    if (!allPoints) continue;
    const [p1x, p1y] = allPoints[0]!;
    const [p2x, p2y] = allPoints[allPoints.length - 1]!;
    const waypoints = allPoints.slice(1, -1);

    const stroke = style.properties.strokeColor ?? "#000000";
    const strokeWidth = Number.parseFloat(style.properties.strokeWidth ?? "1");
    const dashArray = dashArrayAttr(style);
    const { stroke: strokeOpacity } = opacities(style);
    const startMarker = arrowMarkerId(style.properties.startArrow, "start");
    const endMarker = arrowMarkerId(style.properties.endArrow, "end");
    const markerAttrs =
      `${startMarker ? ` marker-start="url(#${startMarker})"` : ""}` +
      `${endMarker ? ` marker-end="url(#${endMarker})"` : ""}`;
    const shape =
      waypoints.length > 0
        ? `<polyline points="${polygonPoints(allPoints)}" fill="none" stroke="${stroke}" ` +
          `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}${markerAttrs}/>`
        : `<line x1="${p1x.toFixed(1)}" y1="${p1y.toFixed(1)}" x2="${p2x.toFixed(1)}" ` +
          `y2="${p2y.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" ` +
          `stroke-opacity="${strokeOpacity}"${dashArray}${markerAttrs}/>`;
    if (glow === "filter") {
      edgeSvg.push(`<g filter="url(#softGlow)">${shape}</g>`);
    } else {
      edgeSvg.push(shape);
    }
  }

  const vertices = cells.filter((c) => c.getAttribute("vertex") === "1");
  // Must match `isContainer` in ../drawio/classifier.ts exactly: draw.io
  // treats swimlane-shaped cells as containers by shape alone, without
  // ever setting `container=1` (issue #27). Checking only `container=1`
  // here left swimlane containers un-hoisted in the paint-order sort
  // below, so a child cell physically preceding its container in the raw
  // XML got painted first, then overwritten by the container's own fill.
  const isContainer = (c: XmlElement) => {
    const { tokens, properties } = parseStyle(c.getAttribute("style") ?? "");
    return (
      tokens.includes("swimlane") ||
      (properties.shape ?? "").startsWith("swimlane") ||
      properties.container === "1"
    );
  };
  // Containers draw before their children so nested nodes render on top.
  // `isContainer` alone only separates containers from non-containers; it
  // does NOT account for multi-level nesting depth. With 3+ levels (e.g.
  // an inner swimlane nested inside an outer one, both containers), a
  // stable sort on that boolean alone preserves the *original* relative
  // document order between same-bucket cells - if the inner container
  // happened to be declared before the outer one, it would still be
  // painted before its own ancestor and get overwritten by it (issue
  // #35 regression test: multi-level nested swimlanes with children out
  // of document order). Sort primarily by ancestor depth (shallower
  // first) so every cell paints after all of its ancestors regardless of
  // document order, then fall back to the existing container-first
  // tiebreak for same-depth siblings.
  const depthCache = new Map<string, number>();
  function depthOf(cellId: string, seen = new Set<string>()): number {
    const cached = depthCache.get(cellId);
    if (cached !== undefined) return cached;
    const cell = cellById.get(cellId);
    const parentId = cell?.getAttribute("parent");
    if (!cell || !parentId || seen.has(cellId)) {
      depthCache.set(cellId, 0);
      return 0;
    }
    seen.add(cellId);
    const depth = 1 + depthOf(parentId, seen);
    depthCache.set(cellId, depth);
    return depth;
  }
  const sortedVertices = [...vertices].sort((a, b) => {
    const depthDiff = depthOf(a.getAttribute("id") ?? "") - depthOf(b.getAttribute("id") ?? "");
    if (depthDiff !== 0) return depthDiff;
    return Number(!isContainer(a)) - Number(!isContainer(b));
  });

  const nodeSvg: string[] = [];
  for (const cell of sortedVertices) {
    const id = cell.getAttribute("id") ?? "";
    if (isHidden(id)) continue;
    const geo = nodeGeo.get(id);
    if (!geo) continue;
    const { x, y, w, h } = geo;
    const style = parseStyle(cell.getAttribute("style") ?? "");
    // A plain `group;` wrapper cell (no container=1) is a layout-only
    // helper in real draw.io - invisible, existing purely so its children
    // can be moved/resized together. Drawing it as a generic rect gives it
    // a spurious visible fill+stroke box that never appears in the real UI.
    if (style.tokens.includes("group") && style.properties.container !== "1") continue;
    const fill = style.properties.fillColor ?? "#ffffff";
    const stroke = style.properties.strokeColor ?? "#000000";
    const fontColor = style.properties.fontColor ?? "#000000";
    const strokeWidth = Number.parseFloat(style.properties.strokeWidth ?? "1");
    const arc = Number.parseFloat(style.properties.arcSize ?? "0");
    const flatRx = Number.isNaN(arc) ? 0 : arc <= 100 ? (arc * Math.min(w, h)) / 100 : arc;
    // mxSwimlane computes its corner arc as a function of the title bar
    // height (`startSize`), not as a flat percentage of the box like a
    // plain rounded rect - see mxgraph's mxSwimlane.getSwimlaneArcSize()
    // (issue #39). Only applies when the cell is a swimlane/container AND
    // has `rounded=1`; a swimlane without `rounded=1` keeps square corners.
    const rx =
      isContainer(cell) && style.properties.rounded === "1"
        ? Math.min(
            Math.min(w, h) / 2,
            Number.parseFloat(style.properties.startSize ?? "40") *
              (Number.parseFloat(style.properties.arcSize ?? "15") / 100) *
              3,
          )
        : flatRx;
    const shape = style.properties.shape ?? "";
    const isEllipse = shape === "ellipse" || style.tokens.includes("ellipse");
    const isRhombus = shape === "rhombus" || style.tokens.includes("rhombus");
    const isHexagon = shape === "hexagon";
    // Matches `isText` in ../drawio/classifier.ts: a `text;`-styled cell
    // (draw.io's "Text" shape) always renders borderless/fill-less in real
    // draw.io, regardless of any strokeColor/fillColor left in its style
    // (issue #29). Falls through with the same conservative heuristic for
    // shape-less, fill-less, border-less vertices.
    const isText =
      style.tokens.includes("text") ||
      (!("shape" in style.properties) &&
        !("fillColor" in style.properties) &&
        style.properties.strokeColor === "none");
    const label = cell.getAttribute("value") ?? "";
    const isHtmlLabel = style.properties.html === "1";
    const fontFamily = `${style.properties.fontFamily ?? ""}, ${FONT_FALLBACK_STACK}`.replace(
      /^,\s*/,
      "",
    );
    const fontSize = style.properties.fontSize ?? "12";
    const valign = style.properties.verticalAlign ?? "middle";
    const align = style.properties.align ?? "center";
    const spacingLeft = Number.parseFloat(style.properties.spacingLeft ?? "0") || 0;
    // horizontal=0 marks a rotated (vertical) swimlane title, typically a
    // side panel; its label runs bottom-to-top along the left edge
    // instead of sitting horizontally centered like a normal node/container.
    const rotatedLabel = style.properties.horizontal === "0";
    // draw.io's fontStyle is a bitmask (1=bold, 2=italic, 4=underline,
    // freely combinable, e.g. 3=bold+italic) - not an exact-match enum.
    const fontStyleBits = Number.parseInt(style.properties.fontStyle ?? "0", 10) || 0;
    const isBold = (fontStyleBits & 1) !== 0;
    const isItalic = (fontStyleBits & 2) !== 0;
    const isUnderline = (fontStyleBits & 4) !== 0;
    const fontAttrs =
      (isBold ? ' font-weight="bold"' : "") +
      (isItalic ? ' font-style="italic"' : "") +
      (isUnderline ? ' text-decoration="underline"' : "");
    let textY = valign === "top" ? y + 18 : y + h / 2 + 5;
    const fillRef = glow === "filter" ? `url(#${gradientFor(fill)})` : fill;
    const dashArray = dashArrayAttr(style);
    const { fill: fillOpacity, stroke: strokeOpacity } = opacities(style);
    // Collect this cell's shape + label markup separately so an optional
    // `rotation=NN` can wrap the whole node in a single `<g transform=
    // "rotate(...)">` at the end, instead of rotating each piece apart.
    const cellSvg: string[] = [];

    if (shape.includes("cylinder")) {
      // Matches real mxgraph's mxCylinder.js getCylinderSize(): the
      // ellipse cap height is proportional (h/5) but capped at a flat
      // 40px for tall cylinders, instead of scaling forever.
      const eh = Math.min(40, Math.round(h / 5));
      const cyl =
        `<g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}" ` +
        `fill="${fillRef}" fill-opacity="${fillOpacity}"${dashArray}>` +
        `<path d="M ${x},${y + eh} L ${x},${y + h - eh} A ${w / 2},${eh} 0 0 0 ${x + w},${y + h - eh} ` +
        `L ${x + w},${y + eh} A ${w / 2},${eh} 0 0 0 ${x},${y + eh} Z"/>` +
        `<ellipse cx="${x + w / 2}" cy="${y + eh}" rx="${w / 2}" ry="${eh}"/>` +
        "</g>";
      cellSvg.push(glow === "filter" ? `<g filter="url(#softGlow)">${cyl}</g>${cyl}` : cyl);
      textY = y + h / 2 + eh / 2;
    } else if (shape === "image" && style.properties.image) {
      // shape=image cells (e.g. embedded PNG icons via a data: URI) have
      // no fill/stroke box in real draw.io - draw the image itself
      // instead of falling through to the generic filled rect below,
      // which used to render icons as a blank placeholder rectangle.
      cellSvg.push(
        `<image x="${x}" y="${y}" width="${w}" height="${h}" ` +
          `href="${escapeXml(normalizeDataUri(style.properties.image))}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    } else if (isEllipse) {
      const ellipse =
        `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ` +
        `fill="${fillRef}" fill-opacity="${fillOpacity}" stroke="${stroke}" ` +
        `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      cellSvg.push(
        glow === "filter" ? `<g filter="url(#softGlow)">${ellipse}</g>${ellipse}` : ellipse,
      );
    } else if (isRhombus) {
      const points = rhombusPoints(x, y, w, h);
      const rhombus =
        `<polygon points="${polygonPoints(points)}" fill="${fillRef}" fill-opacity="${fillOpacity}" ` +
        `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      cellSvg.push(
        glow === "filter" ? `<g filter="url(#softGlow)">${rhombus}</g>${rhombus}` : rhombus,
      );
    } else if (isText) {
      // No box at all - real draw.io renders the "Text" shape as a bare
      // label with no fill/stroke, regardless of style properties.
    } else if (isHexagon) {
      // Matches real draw.io's default hexagon inset (~25% of width for
      // the slanted side cuts).
      const points = hexagonPoints(x, y, w, h);
      const hexagon =
        `<polygon points="${polygonPoints(points)}" fill="${fillRef}" fill-opacity="${fillOpacity}" ` +
        `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      cellSvg.push(
        glow === "filter" ? `<g filter="url(#softGlow)">${hexagon}</g>${hexagon}` : hexagon,
      );
    } else if (
      isContainer(cell) &&
      (Number.parseFloat(style.properties.startSize ?? "0") || 0) > 0
    ) {
      // Real draw.io's mxSwimlane only fills the title-bar strip
      // (startSize-wide/tall) with `fillColor`; the body region past it is
      // left unfilled (page background shows through) unless the style
      // explicitly sets `swimlaneFillColor` (issue #42, mxSwimlane.js
      // `apply()`/`paintRoundedSwimlane()`). Only the outer corners of each
      // region are rounded in real draw.io - the seam between title and
      // body is a straight internal edge - but this offline renderer
      // reuses the single `rx` computed above on both rects for
      // simplicity, matching this project's documented "approximate, not
      // pixel-perfect" rendering tradeoffs.
      const startSize = Math.max(0, Number.parseFloat(style.properties.startSize ?? "0") || 0);
      const rotatedTitle = style.properties.horizontal === "0";
      const titleW = rotatedTitle ? Math.min(startSize, w) : w;
      const titleH = rotatedTitle ? h : Math.min(startSize, h);
      const bodyFill = style.properties.swimlaneFillColor;
      const bodyFillRef =
        bodyFill === undefined
          ? "none"
          : glow === "filter"
            ? `url(#${gradientFor(bodyFill)})`
            : bodyFill;
      const titleRect =
        `<rect x="${x}" y="${y}" width="${titleW}" height="${titleH}" rx="${rx}" ` +
        `fill="${fillRef}" fill-opacity="${fillOpacity}" stroke="${stroke}" ` +
        `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      const bodyRect = rotatedTitle
        ? `<rect x="${x + titleW}" y="${y}" width="${w - titleW}" height="${h}" rx="${rx}" ` +
          `fill="${bodyFillRef}" fill-opacity="${fillOpacity}" stroke="${stroke}" ` +
          `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`
        : `<rect x="${x}" y="${y + titleH}" width="${w}" height="${h - titleH}" rx="${rx}" ` +
          `fill="${bodyFillRef}" fill-opacity="${fillOpacity}" stroke="${stroke}" ` +
          `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      cellSvg.push(
        glow === "filter" ? `<g filter="url(#softGlow)">${titleRect}</g>${titleRect}` : titleRect,
      );
      cellSvg.push(bodyRect);
    } else {
      const rect =
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ` +
        `fill="${fillRef}" fill-opacity="${fillOpacity}" stroke="${stroke}" ` +
        `stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"${dashArray}/>`;
      cellSvg.push(glow === "filter" ? `<g filter="url(#softGlow)">${rect}</g>${rect}` : rect);
    }

    const wrap = style.properties.whiteSpace === "wrap";
    interface RenderLine {
      text: string;
      fontAttrs: string;
    }
    const buildFontAttrs = (bold: boolean, italic: boolean): string =>
      (bold ? ' font-weight="bold"' : "") +
      (italic ? ' font-style="italic"' : "") +
      (isUnderline ? ' text-decoration="underline"' : "");
    let lines: RenderLine[];
    if (isHtmlLabel) {
      // Each HTML line may carry its own bold/italic override from a
      // full-line-wrapping `<span style="...">` (issue #38); re-wrap each
      // source line independently (rather than the whole flattened label
      // at once) so that override still applies to any width-driven
      // re-wrap of that line.
      lines = parseHtmlLabelLines(label).flatMap((htmlLine) => {
        const bold = htmlLine.bold ?? isBold;
        const italic = htmlLine.italic ?? isItalic;
        const fontAttrs = buildFontAttrs(bold, italic);
        const wrapped = wrap ? wrapLabel(htmlLine.text, w, fontSize, bold) : [htmlLine.text];
        return wrapped.map((text) => ({ text, fontAttrs }));
      });
    } else {
      const wrapped = wrap ? wrapLabel(label, w, fontSize, isBold) : label.split("\n");
      lines = wrapped.map((text) => ({ text, fontAttrs }));
    }

    // Center the whole multi-line block around the single-line textY
    // (rather than pinning the first line there and pushing later lines
    // further down), matching mxgraph's mxText.js block-centering for
    // verticalAlign=middle. Top-aligned labels grow downward as before.
    const lineHeight = (Number.parseFloat(fontSize) || 12) * LINE_HEIGHT_FACTOR;
    if (valign !== "top") {
      textY -= ((lines.length - 1) * lineHeight) / 2;
    }

    lines.forEach(({ text: line, fontAttrs: lineFontAttrs }, i) => {
      if (rotatedLabel) {
        // Rotate about the label's own anchor point so it reads
        // bottom-to-top along the left edge, matching draw.io's
        // horizontal=0 swimlane title convention.
        // Center the whole label block on the mid-point, then offset each
        // line by i * lineHeight along the (pre-rotation) x-axis so lines
        // don't overlap - matches the unrotated branch's `textY + i *
        // lineHeight` offset, just applied before the -90deg rotation.
        const px = x + 16 + spacingLeft + i * lineHeight;
        const py = y + h / 2;
        cellSvg.push(
          `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" text-anchor="middle" ` +
            `font-family="${fontFamily}" font-size="${fontSize}" fill="${fontColor}"${lineFontAttrs} ` +
            `transform="rotate(-90 ${px.toFixed(1)} ${py.toFixed(1)})">${escapeXml(line)}</text>`,
        );
        return;
      }

      let textX = x + w / 2;
      let textAnchor = "middle";
      if (align === "left") {
        textX = x + 4 + spacingLeft;
        textAnchor = "start";
      } else if (align === "right") {
        textX = x + w - 4 - spacingLeft;
        textAnchor = "end";
      }

      cellSvg.push(
        `<text x="${textX}" y="${textY + i * lineHeight}" text-anchor="${textAnchor}" ` +
          `font-family="${fontFamily}" font-size="${fontSize}" fill="${fontColor}"${lineFontAttrs}>${escapeXml(line)}</text>`,
      );
    });

    const rotation = Number.parseFloat(style.properties.rotation ?? "0");
    if (!Number.isNaN(rotation) && rotation !== 0) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      nodeSvg.push(`<g transform="rotate(${rotation} ${cx} ${cy})">${cellSvg.join("")}</g>`);
    } else {
      nodeSvg.push(...cellSvg);
    }
  }

  /**
   * The renderer used to hard-code an 850x700 canvas regardless of the
   * document's actual page size (the "squeezed" bug: a diagram authored on
   * draw.io's default 1600x900+ canvas got clipped/squeezed into 850x700).
   * Prefer the real `<mxGraphModel pageWidth/pageHeight>` attributes, but
   * grow the canvas to fit the bounding box of every node's absolute
   * geometry (with a small margin) when content overflows the declared
   * page size — matching real draw.io's PNG export behavior. Only fall
   * back to the 850x700 default when neither a declared page size nor
   * any content is available.
   */
  const modelPageWidth = numAttr(root, "pageWidth", 0);
  const modelPageHeight = numAttr(root, "pageHeight", 0);
  let bboxRight = 0;
  let bboxBottom = 0;
  for (const geo of nodeGeo.values()) {
    bboxRight = Math.max(bboxRight, geo.x + geo.w);
    bboxBottom = Math.max(bboxBottom, geo.y + geo.h);
  }
  const margin = 20;
  const diagramWidth = Math.max(modelPageWidth, bboxRight ? bboxRight + margin : 0) || 850;
  const diagramHeight = Math.max(modelPageHeight, bboxBottom ? bboxBottom + margin : 0) || 700;

  return { nodeSvg, edgeSvg, width: diagramWidth, height: diagramHeight };
}

/** Gap in px drawn between stacked pages when a document has more than one. */
const PAGE_GAP = 40;

/**
 * Renders every page of a `.drawio` document as an approximate SVG,
 * reusing the document model (handles both inline and compressed page
 * content transparently). Multiple pages are stacked vertically, each
 * translated into its own band of the canvas, rather than silently
 * dropping everything after the first page.
 */
export function renderDrawioToSvg(drawioXml: string, options: RenderOptions = {}): string {
  const { background = "#ffffff", glow = "none" } = options;

  const doc = loadDrawioDocument(drawioXml);
  const pages = getPages(doc);
  const modelXmls =
    pages.length > 0 ? pages.map((p) => p.getModelXml()) : ["<mxGraphModel><root/></mxGraphModel>"];

  const defs: string[] = [
    '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" ' +
      'refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#888"/></marker>',
    '<marker id="arrowStart" markerWidth="10" markerHeight="10" refX="1" ' +
      'refY="3" orient="auto-start-reverse"><path d="M0,0 L0,6 L9,3 z" fill="#888"/></marker>',
    '<marker id="diamond" markerWidth="12" markerHeight="8" refX="10" refY="4" ' +
      'orient="auto"><path d="M0,4 L6,0 L12,4 L6,8 z" fill="#888"/></marker>',
    '<marker id="diamondStart" markerWidth="12" markerHeight="8" refX="2" refY="4" ' +
      'orient="auto-start-reverse"><path d="M0,4 L6,0 L12,4 L6,8 z" fill="#888"/></marker>',
    '<marker id="oval" markerWidth="8" markerHeight="8" refX="6" refY="4" ' +
      'orient="auto"><circle cx="4" cy="4" r="3.5" fill="#888"/></marker>',
    '<marker id="ovalStart" markerWidth="8" markerHeight="8" refX="2" refY="4" ' +
      'orient="auto-start-reverse"><circle cx="4" cy="4" r="3.5" fill="#888"/></marker>',
  ];
  if (glow === "filter") {
    defs.push(
      '<filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">' +
        '<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>' +
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        "</filter>",
    );
  }
  const gradientIds = new Map<string, string>();

  let canvasWidth = 0;
  let yOffset = 0;
  const pageGroups: string[] = [];
  for (const modelXml of modelXmls) {
    const page = renderPage(modelXml, glow, defs, gradientIds);
    canvasWidth = Math.max(canvasWidth, page.width);
    const translate = yOffset === 0 ? "" : ` transform="translate(0,${yOffset})"`;
    pageGroups.push(`<g${translate}>${[...page.edgeSvg, ...page.nodeSvg].join("\n")}</g>`);
    yOffset += page.height + PAGE_GAP;
  }
  const canvasHeight = yOffset > 0 ? yOffset - PAGE_GAP : 0;

  const width = options.width ?? canvasWidth;
  const height = options.height ?? canvasHeight;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
    `<rect width="${canvasWidth}" height="${canvasHeight}" fill="${background}"/>`,
    `<defs>${defs.join("")}</defs>`,
    ...pageGroups,
    "</svg>",
  ];
  return parts.join("\n");
}

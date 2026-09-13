/**
 * Lightweight, offline `.drawio` -> SVG preview renderer (issue #5).
 *
 * TypeScript port of `scripts/render-drawio-preview.py`, built on top of
 * the document model the CLI already constructs (`loadDrawioDocument` /
 * `getPages`) instead of re-parsing the raw `.drawio` XML from scratch -
 * this guarantees the preview reflects exactly the same page content
 * (inline or compressed) that the rest of the pipeline sees, rather than
 * a second, independent XML parse.
 *
 * NOT a replacement for draw.io's real renderer: no waypoints, no HTML
 * labels, no groups/rotation. It reads mxCell fill/stroke/font colors and
 * basic shapes (rect/cylinder) and draws an approximate SVG, good enough
 * for a quick visual diff.
 */
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement } from "@xmldom/xmldom";
import { getPages, loadDrawioDocument } from "../drawio/document.js";
import { parseStyle } from "../drawio/styles.js";

/**
 * The generated `.drawio` file's fontFamily (e.g. "Inter") is a valid,
 * bundled web font in real draw.io/diagrams.net, but an offline preview
 * environment may have no such font installed. Rather than mutate the
 * theme's actual fontFamily token, append known-installed fallbacks here
 * so the *preview* still renders a modern sans instead of the
 * rasterizer's serif default for an unrecognized font name.
 */
export const FONT_FALLBACK_STACK = "Noto Sans, Helvetica Neue, Arial, sans-serif";

/** Whether to draw a soft glow behind nodes/edges using a real SVG `<filter>`. */
export type GlowMode = "none" | "filter";

export interface PreviewOptions {
  /** Background fill color for the canvas. Defaults to `#ffffff`. */
  background?: string;
  /** Glow rendering mode (feGaussianBlur + gradients). Defaults to `"none"`. */
  glow?: GlowMode;
  /** Canvas width in px. Defaults to 850. */
  width?: number;
  /** Canvas height in px. Defaults to 700. */
  height?: number;
}

interface NodeGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders the first page of a `.drawio` document as an approximate SVG
 * preview, reusing the document model (handles both inline and
 * compressed page content transparently).
 */
export function renderDrawioToSvg(drawioXml: string, options: PreviewOptions = {}): string {
  const { background = "#ffffff", glow = "none", width = 850, height = 700 } = options;

  const doc = loadDrawioDocument(drawioXml);
  const pages = getPages(doc);
  const modelXml = pages[0]?.getModelXml() ?? "<mxGraphModel><root/></mxGraphModel>";
  const modelDoc = new DOMParser().parseFromString(modelXml, "text/xml");
  const root = modelDoc.documentElement as unknown as XmlElement;
  const cells = childElements(root, "mxCell");

  const defs: string[] = [
    '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" ' +
      'refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#888"/></marker>',
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

  const nodeGeo = new Map<string, NodeGeometry>();
  for (const cell of cells) {
    if (cell.getAttribute("vertex") !== "1") continue;
    const id = cell.getAttribute("id");
    const geoNodes = childElements(cell, "mxGeometry");
    const geo = geoNodes[0];
    if (!id || !geo) continue;
    nodeGeo.set(id, {
      x: numAttr(geo, "x"),
      y: numAttr(geo, "y"),
      w: numAttr(geo, "width"),
      h: numAttr(geo, "height"),
    });
  }

  function center(id: string | null): [number, number] | null {
    if (!id) return null;
    const geo = nodeGeo.get(id);
    return geo ? [geo.x + geo.w / 2, geo.y + geo.h / 2] : null;
  }

  const edgeSvg: string[] = [];
  for (const cell of cells) {
    if (cell.getAttribute("edge") !== "1") continue;
    const style = parseStyle(cell.getAttribute("style") ?? "");
    const src = cell.getAttribute("source");
    const tgt = cell.getAttribute("target");
    const c1 = center(src);
    const c2 = center(tgt);
    if (!c1 || !c2 || !src || !tgt) continue;
    const sourceGeo = nodeGeo.get(src);
    const targetGeo = nodeGeo.get(tgt);
    if (!sourceGeo || !targetGeo) continue;
    const [p1x, p1y] = clipToRect(c1[0], c1[1], c2[0], c2[1], sourceGeo.w, sourceGeo.h);
    const [p2x, p2y] = clipToRect(c2[0], c2[1], c1[0], c1[1], targetGeo.w, targetGeo.h);
    const stroke = style.properties.strokeColor ?? "#000000";
    const strokeWidth = Number.parseFloat(style.properties.strokeWidth ?? "1");
    const line =
      `<line x1="${p1x.toFixed(1)}" y1="${p1y.toFixed(1)}" x2="${p2x.toFixed(1)}" ` +
      `y2="${p2y.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" ` +
      `stroke-opacity="1" marker-end="url(#arrow)"/>`;
    if (glow === "filter") {
      edgeSvg.push(`<g filter="url(#softGlow)">${line}</g>`);
    } else {
      edgeSvg.push(line);
    }
  }

  const vertices = cells.filter((c) => c.getAttribute("vertex") === "1");
  const isContainer = (c: XmlElement) => (c.getAttribute("style") ?? "").includes("container=1");
  // Containers draw before their children so nested nodes render on top.
  const sortedVertices = [...vertices].sort(
    (a, b) => Number(!isContainer(a)) - Number(!isContainer(b)),
  );

  const nodeSvg: string[] = [];
  for (const cell of sortedVertices) {
    const geo = nodeGeo.get(cell.getAttribute("id") ?? "");
    if (!geo) continue;
    const { x, y, w, h } = geo;
    const style = parseStyle(cell.getAttribute("style") ?? "");
    const fill = style.properties.fillColor ?? "#ffffff";
    const stroke = style.properties.strokeColor ?? "#000000";
    const fontColor = style.properties.fontColor ?? "#000000";
    const strokeWidth = Number.parseFloat(style.properties.strokeWidth ?? "1");
    const arc = Number.parseFloat(style.properties.arcSize ?? "0");
    const rx = Number.isNaN(arc) ? 0 : arc <= 100 ? (arc * Math.min(w, h)) / 100 : arc;
    const shape = style.properties.shape ?? "";
    const label = cell.getAttribute("value") ?? "";
    const fontFamily = `${style.properties.fontFamily ?? ""}, ${FONT_FALLBACK_STACK}`.replace(
      /^,\s*/,
      "",
    );
    const fontSize = style.properties.fontSize ?? "12";
    const valign = style.properties.verticalAlign ?? "middle";
    const bold = style.properties.fontStyle === "1" ? 'font-weight="bold"' : "";
    let textY = valign === "top" ? y + 18 : y + h / 2 + 5;
    const fillRef = glow === "filter" ? `url(#${gradientFor(fill)})` : fill;

    if (shape.includes("cylinder")) {
      const eh = h * 0.18;
      const cyl =
        `<g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="1" fill="${fillRef}">` +
        `<path d="M ${x},${y + eh} L ${x},${y + h - eh} A ${w / 2},${eh} 0 0 0 ${x + w},${y + h - eh} ` +
        `L ${x + w},${y + eh} A ${w / 2},${eh} 0 0 0 ${x},${y + eh} Z"/>` +
        `<ellipse cx="${x + w / 2}" cy="${y + eh}" rx="${w / 2}" ry="${eh}"/>` +
        "</g>";
      nodeSvg.push(glow === "filter" ? `<g filter="url(#softGlow)">${cyl}</g>${cyl}` : cyl);
      textY = y + h / 2 + eh / 2;
    } else {
      const rect =
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ` +
        `fill="${fillRef}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="1"/>`;
      nodeSvg.push(glow === "filter" ? `<g filter="url(#softGlow)">${rect}</g>${rect}` : rect);
    }

    label.split("\n").forEach((line, i) => {
      nodeSvg.push(
        `<text x="${x + w / 2}" y="${textY + i * 14}" text-anchor="middle" ` +
          `font-family="${fontFamily}" font-size="${fontSize}" fill="${fontColor}" ${bold}>${escapeXml(line)}</text>`,
      );
    });
  }

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    `<defs>${defs.join("")}</defs>`,
    ...edgeSvg,
    ...nodeSvg,
    "</svg>",
  ];
  return parts.join("\n");
}

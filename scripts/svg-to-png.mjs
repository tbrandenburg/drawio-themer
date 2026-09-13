#!/usr/bin/env node
/**
 * Rasterize an SVG file (e.g. one produced by render-drawio-preview.py) to
 * PNG using @resvg/resvg-js. Thin wrapper around the real implementation
 * in src/render/rasterize.ts (shipped as dist/render/rasterize.js), kept
 * here so the SVG-to-PNG step is still scriptable standalone for
 * docs/demo work without going through the full `apply` CLI.
 *
 * Usage: node scripts/svg-to-png.mjs <input.svg> <output.png>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { rasterizeSvgToPng } from "../dist/render/rasterize.js";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("Usage: node scripts/svg-to-png.mjs <input.svg> <output.png>");
  process.exit(1);
}

const svg = readFileSync(input, "utf8");
writeFileSync(output, rasterizeSvgToPng(svg));

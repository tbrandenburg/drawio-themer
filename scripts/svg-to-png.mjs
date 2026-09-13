#!/usr/bin/env node
/**
 * Rasterize an SVG file (e.g. one produced by render-drawio-preview.py) to
 * PNG using @resvg/resvg-js - a native Rust SVG renderer with prebuilt
 * binaries for Linux/macOS/Windows (x64 + arm64), no browser, no system
 * dependencies, no network access at render time.
 *
 * Chosen over the alternatives after evaluating all three available in
 * this project's environment:
 * - ImageMagick `convert`: falls back to the bundled MSVG delegate when
 *   `rsvg-convert` isn't installed - no <filter> support, weak
 *   anti-aliasing, no gradients. Poor visual quality.
 * - Playwright/Chromium screenshot: excellent visual quality (real
 *   browser engine), but ~300MB Chromium download, Linux system deps
 *   (`--with-deps`), and requires spinning up a local HTTP server (the
 *   MCP browser blocks `file://`) plus manual navigate/screenshot steps -
 *   high overhead, more moving parts to keep reproducible across
 *   machines/CI.
 * - @resvg/resvg-js (this script): full <filter> (feGaussianBlur/
 *   feMerge), gradients, and real anti-aliasing - visually
 *   indistinguishable from the Chromium screenshot in side-by-side
 *   testing - via a single ~4MB native addon and one function call. No
 *   server, no browser, no manual steps. This is the reproducible,
 *   multi-platform default; reach for the Playwright pipeline only if a
 *   diagram needs a feature resvg doesn't support.
 *
 * Usage: node scripts/svg-to-png.mjs <input.svg> <output.png>
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("Usage: node scripts/svg-to-png.mjs <input.svg> <output.png>");
  process.exit(1);
}

const svg = readFileSync(input, "utf8");
const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
writeFileSync(output, resvg.render().asPng());

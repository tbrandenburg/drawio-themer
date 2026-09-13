# AGENTS.md

## Purpose

`drawio-themer` is a CLI that applies modern, semantic visual themes (e.g.
the bundled `shadcn-modern` theme) to existing draw.io / diagrams.net
`.drawio` files. It rewrites only presentational style properties
(fill/stroke/font colors, corner radius, edge styling, etc.) via a
YAML-defined theme, while preserving diagram geometry, topology,
connections, shape semantics (e.g. `shape=cylinder3` stays a database),
and embedded images/icons untouched.

It supports both inline and compressed (`raw-deflate` + base64) draw.io
page content, multi-page documents, and is idempotent — re-applying a
theme to an already-themed file is a no-op.

## Product requirements

The full product requirements, design rationale, theme format, style
allow-list, classification rules, and implementation plan live in
[`docs/PRD.md`](docs/PRD.md). Read that first before making any
behavioral change to the classifier, style parser, theme compiler, or
transformer — those modules implement the PRD's spec directly and their
public contracts should stay traceable back to a PRD section.

## Make targets

Common tasks are wrapped in a `Makefile` with a dependency chain
(`format-check` -> `lint` -> `build`/`test` -> `run` -> `release-*`), so
running a later target always re-verifies the earlier gates first.

| Target          | Depends on                                                         | What it does                                          |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `install`       | `node_modules` (auto, keyed on `package.json`/`package-lock.json`) | `npm install`                                         |
| `format`        | `install`                                                          | `prettier --write .` (mutates files)                  |
| `format-check`  | `install`                                                          | `prettier --check .` (non-mutating, CI-safe)          |
| `lint`          | `format-check`                                                     | `eslint .`                                            |
| `build`         | `install`                                                          | `tsc` + copies `src/themes/*.yaml` into `dist/themes` |
| `test`          | `lint`, `build`                                                    | `vitest run`                                          |
| `run`           | `test`                                                             | `node dist/cli.js --version`                          |
| `release-patch` | `run`                                                              | `npm version patch` + `git push --follow-tags`        |
| `release-minor` | `run`                                                              | `npm version minor` + `git push --follow-tags`        |
| `release-major` | `run`                                                              | `npm version major` + `git push --follow-tags`        |
| `release`       | `release-patch`                                                    | Alias for the default (patch) release bump            |
| `clean`         | —                                                                  | `rm -rf dist`                                         |

CI (`.github/workflows/checks.yml`) runs `make format-check`, `make lint`,
and `make test` as three independent required checks (`Checks / Format`,
`Checks / Lint`, `Checks / Tests`) on every pull request.

## Previewing before/after `.drawio` diagrams in chat

There is no real draw.io renderer available offline (no internet, no
draw.io/Electron CLI). `scripts/render-drawio-preview.py` is a
lightweight, offline mxCell-XML-to-SVG approximation (rects, cylinders,
edges clipped to node perimeters, labels) — good enough for a quick
visual diff, not a substitute for opening the file in real draw.io (no
waypoints/groups/rotation/HTML labels).

**Rasterizer choice matters a lot for visual quality. Default to
`scripts/svg-to-png.mjs` (`@resvg/resvg-js`) — reserve the Playwright
browser pipeline for cases it can't handle:**

| Rasterizer                                                                          | Quality  | Overhead                                                                                                                                       | Notes                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`node scripts/svg-to-png.mjs in.svg out.png`** (`@resvg/resvg-js`, devDependency) | **Good** | **Low** — one `npm install`, ~4MB native addon, prebuilt binaries for Linux/macOS/Windows (x64+arm64), single function call, no server/browser | **Default choice.** Full `<filter>` (`feGaussianBlur`/`feMerge`) and gradient support, real anti-aliasing — visually indistinguishable from the Chromium screenshot in side-by-side testing (see git history). Fully scriptable, no manual steps. |
| `convert -background none in.svg out.png` (ImageMagick)                             | Poor     | Low (already installed)                                                                                                                        | No `rsvg-convert` binary in this environment -> silently falls back to ImageMagick's own MSVG delegate: **no `<filter>` support** (blur/glow silently dropped), weak anti-aliasing, no gradients. Looks flat/blocky ("90s" look). Avoid.          |
| `rsvg-convert`                                                                      | N/A here | —                                                                                                                                              | Not installed and no internet to install it (only the `librsvg2-2`/`-common` _libraries_ are present, not the CLI). Don't rely on it existing.                                                                                                    |
| Playwright MCP browser (Chromium)                                                   | Good     | High — ~300MB Chromium download, needs a local HTTP server (`file://` is blocked), manual navigate/screenshot steps per image                  | Fallback only, for whatever `resvg` can't render (e.g. HTML-based `foreignObject` labels). Use `--filter-glow` mode with this path.                                                                                                               |

Default workflow (`resvg`, one command chain, no browser/server):

```bash
node dist/cli.js apply in.drawio -t theme.yaml -o out.drawio
python3 scripts/render-drawio-preview.py in.drawio before.svg "#ffffff"
python3 scripts/render-drawio-preview.py out.drawio after.svg "#09090b" --filter-glow
node scripts/svg-to-png.mjs before.svg before.png
node scripts/svg-to-png.mjs after.svg after.png
```

Notes that still apply regardless of rasterizer:

- **If the fixture uses layer/swimlane boxes that should theme as
  containers**, verify they have `container=1` in their `style` first
  (`grep container= <file>.drawio`) — without it the classifier treats
  them as plain nodes and the theme's `container` rule silently never
  matches (looks "untouched").
- Font handling: the theme's real `fontFamily` (e.g. `Inter`, a web
  font bundled by real draw.io) is _not_ installed in this offline
  sandbox, so `render-drawio-preview.py` appends its own verified
  fallback stack (`Noto Sans, Helvetica Neue, Arial, sans-serif`) to
  every `font-family` it emits — do not edit a theme's `fontFamily`
  token just to fix the local preview's look; fix the renderer's
  fallback stack instead. Verify installed fonts with `fc-match
"<name>"` before assuming a family renders (only `Noto Sans`,
  `Liberation Sans`, `DejaVu Sans` and the `Noto Sans <Script>` CJK/
  Indic families are available here — no `Inter`, no `Arial`/
  `Helvetica` as real font files, only fontconfig aliases to
  Liberation Sans). `resvg`'s `font.loadSystemFonts` option picks these
  up automatically via fontconfig, same as the browser pipeline.
- **Before claiming the render is correct, read the PNG back with an
  image-capable Read tool and visually inspect it** — do not infer
  correctness from the SVG source (e.g. grepping for `filter=` proves
  nothing about whether the chosen rasterizer actually honors it) or
  from the CLI's `--verbose` "themed" counts (they prove the theme
  compiled, not that the preview rendered it visibly).
- Save PNGs under `.playwright-mcp/` (gitignored, for chat-only scratch
  work) or `docs/assets/` (committed, for README/docs) with a **fresh,
  unique filename per revision** (e.g. `themed-v2.png`, not a reused
  `themed.png`) — chat clients cache images by path/filename, so
  overwriting the same name can show a stale image even after the
  underlying file changed.

### Fallback: Playwright browser pipeline

Only needed for SVG features `resvg` doesn't support. Adds a real
browser engine at the cost of much higher overhead (Chromium install, a
local HTTP server, manual per-image navigate/screenshot calls):

1. Render SVG as above.
2. Wrap in a minimal HTML file (`<body style="margin:0"><svg>...</svg></body>`)
   and serve it over local HTTP (`python3 -m http.server <port>` in the
   SVG's directory) — the Playwright MCP browser blocks `file://` URLs.
3. `playwright_browser_navigate` to `http://localhost:<port>/<file>.html`,
   then screenshot **the `svg` element itself** (`target: "svg"`), not
   the full viewport — viewport screenshots leave black/white margin
   artifacts when the window size doesn't match the SVG's dimensions.
4. Kill the HTTP server afterward (find its PID via `ss -ltnp` and kill
   that PID directly — do not `pkill -f`, see root AGENTS.md).

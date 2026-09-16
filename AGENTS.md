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

| Target           | Depends on                                                         | What it does                                          |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `install`        | `node_modules` (auto, keyed on `package.json`/`package-lock.json`) | `npm install`                                         |
| `format`         | `install`                                                          | `prettier --write .` (mutates files)                  |
| `format-check`   | `install`                                                          | `prettier --check .` (non-mutating, CI-safe)          |
| `lint`           | `format-check`                                                     | `eslint .`                                            |
| `build`          | `install`                                                          | `tsc` + copies `src/themes/*.yaml` into `dist/themes` |
| `test`           | `lint`, `build`                                                    | `vitest run`                                          |
| `run`            | `test`                                                             | `node dist/cli.js --version`                          |
| `install-global` | `build`                                                            | `npm install -g .` (adds `drawio-themer` to PATH)     |
| `release-patch`  | `run`                                                              | `npm version patch` + `git push --follow-tags`        |
| `release-minor`  | `run`                                                              | `npm version minor` + `git push --follow-tags`        |
| `release-major`  | `run`                                                              | `npm version major` + `git push --follow-tags`        |
| `release`        | `release-patch`                                                    | Alias for the default (patch) release bump            |
| `clean`          | —                                                                  | `rm -rf dist`                                         |

CI (`.github/workflows/checks.yml`) runs `make format-check`, `make lint`,
and `make test` as three independent required checks (`Checks / Format`,
`Checks / Lint`, `Checks / Tests`) on every pull request.

## Rendering before/after `.drawio` diagrams in chat

There is no real draw.io renderer available offline (no internet, no
draw.io/Electron CLI). Since issue #5, `apply` has built-in
`--png-original`/`--png-themed` (alias `--png`) flags that render an
offline, approximate SVG-to-PNG rasterization (rects, cylinders, edges
clipped to node perimeters, labels, via `src/render/svg.ts` +
`src/render/rasterize.ts`, `@resvg/resvg-js`) — good enough for a quick
visual diff, not a substitute for opening the file in real draw.io (no
waypoints/groups/rotation/HTML labels). Since issue #9, the same
`src/render/svg.ts` output can also be written directly as a real SVG
file via `--svg-original`/`--svg-themed` (alias `--svg`), without the PNG
rasterization step.

Default workflow — a single command, no separate Python/SVG steps:

```bash
make build
node dist/cli.js apply in.drawio -t theme.yaml -o out.drawio \
  --png-original before.png \
  --png-themed after.png
```

Concrete, copy-pasteable, runnable-from-a-fresh-clone example (this is
how a before/after PNG pair like the README's hero image can be
reproduced; `dark-neon-mode` is a bundled built-in theme registered in
`src/commands/apply.ts`'s `BUILTIN_THEMES` map, and the fixture lives in
`docs/assets/fixtures/`, so no external/temp files are needed):

```bash
make build
node dist/cli.js apply docs/assets/fixtures/layered-architecture.drawio \
  -t dark-neon-mode -o /tmp/demo-after.drawio \
  --png-original docs/assets/demo-before.png \
  --png-themed docs/assets/demo-after.png
```

If you add a new bundled theme for a demo image like this, register it in
`BUILTIN_THEMES` (`src/commands/apply.ts`) so `-t <name>` resolves it by
name — a theme file sitting only in `src/themes/` is not enough, and a
theme/fixture living only in `/tmp` makes the recipe above
unreproducible for the next person.

Notes that still apply:

- **If the fixture uses layer/swimlane boxes that should theme as
  containers**, verify they have `container=1` in their `style` first
  (`grep container= <file>.drawio`) — without it the classifier treats
  them as plain nodes and the theme's `container` rule silently never
  matches (looks "untouched").
- Font handling: the theme's real `fontFamily` (e.g. `Inter`, a web
  font bundled by real draw.io) is _not_ installed in this offline
  sandbox, so `src/render/svg.ts` appends its own verified
  fallback stack (`Noto Sans, Helvetica Neue, Arial, sans-serif`) to
  every `font-family` it emits — do not edit a theme's `fontFamily`
  token just to fix the local render's look; fix the renderer's
  fallback stack instead. Verify installed fonts with `fc-match
"<name>"` before assuming a family renders (only `Noto Sans`,
  `Liberation Sans`, `DejaVu Sans` and the `Noto Sans <Script>` CJK/
  Indic families are available here — no `Inter`, no `Arial`/
  `Helvetica` as real font files, only fontconfig aliases to
  Liberation Sans). `resvg`'s `font.loadSystemFonts` option picks these
  up automatically via fontconfig.
- **Before claiming the render is correct, read the PNG back with an
  image-capable Read tool and visually inspect it** — do not infer
  correctness from the SVG source or from the CLI's `--verbose`
  "themed" counts (they prove the theme compiled, not that the render
  rendered it visibly).
- Save PNGs under `.playwright-mcp/` (gitignored, for chat-only scratch
  work) or `docs/assets/` (committed, for README/docs) with a **fresh,
  unique filename per revision** (e.g. `themed-v2.png`, not a reused
  `themed.png`) — chat clients cache images by path/filename, so
  overwriting the same name can show a stale image even after the
  underlying file changed.

### Structural fidelity limits vs real draw.io (not just unfixed bugs)

Real draw.io (jgraph/drawio's vendored mxgraph fork) renders labels as
live HTML inside SVG `<foreignObject>` elements and delegates word-wrap
to the browser's own CSS reflow (or, in its non-DOM fallback path, to
`canvas.measureText()` — still a real browser/OS font engine). Its own
PNG export runs Chromium via Electron and calls `capturePage()` against
that live rendered DOM. Our offline renderer
(`src/render/svg.ts` + `src/render/rasterize.ts`) is instead a
from-scratch, static SVG generator rasterized by `resvg` — a static SVG
interpreter with no `<foreignObject>`/HTML support, no web-font loading,
and only partial CSS filter support. Given that architecture, some
divergence from real draw.io's export is **structural, not just
currently-unfixed**:

- **Expected to be exactly correct**: geometry (position/size), shape
  classification (e.g. `shape=cylinder3` stays a cylinder), paint order,
  and colors/theming applied by the theme compiler. A pixel diff here is
  a real bug — file it.
- **Expected to differ, and likely to stay approximate**: fine-grained
  text layout (`wrapLabel`'s character-width heuristic vs. a real
  font-metrics/DOM reflow engine), any `<foreignObject>`/HTML-label edge
  case, and CSS filter effects (shadows, blurs) beyond what `resvg`
  supports. Before filing a new pixel-diff issue in these categories,
  check whether it's better explained as an inherent approximation of
  this architecture than a fixable bug.

Adopting a browser-engine-based rendering backend (see the opt-in
Chromium rasterization backend proposed in issue #34) would close these
gaps by construction; short of that, expect them to persist across
further `wrapLabel`/`svg.ts` fixes.

### Fallback: standalone scripts / Playwright browser pipeline

`scripts/render-drawio-preview.py` (Python) and `scripts/svg-to-png.mjs`
(thin wrapper around `src/render/rasterize.ts`) still exist standalone
for docs/demo work outside the CLI, or for whatever SVG feature `resvg`
doesn't support (e.g. HTML-based `foreignObject` labels):

```bash
python3 scripts/render-drawio-preview.py in.drawio before.svg "#ffffff"
node scripts/svg-to-png.mjs before.svg before.png
```

For the rare case `resvg` can't render a feature, fall back to a real
browser engine (much higher overhead: Chromium install, a local HTTP
server, manual per-image navigate/screenshot calls):

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

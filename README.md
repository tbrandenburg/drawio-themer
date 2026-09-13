# drawio-themer

Apply modern, semantic visual themes to existing draw.io / diagrams.net
`.drawio` files — from the command line, without touching geometry,
topology, or shape semantics.

[![Checks](https://github.com/tbrandenburg/drawio-themer/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/tbrandenburg/drawio-themer/actions/workflows/checks.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<table>
<tr>
<th align="center">Before</th>
<th align="center">After — <code>dark-neon-mode</code> theme</th>
</tr>
<tr>
<td><img src="docs/assets/demo-before.png" alt="Layered architecture diagram before theming" width="420"></td>
<td><img src="docs/assets/demo-after.png" alt="Layered architecture diagram after applying a dark neon theme" width="420"></td>
</tr>
</table>

## Table of contents

- [Why](#why)
- [Features](#features)
- [Install](#install)
- [Usage](#usage)
- [Themes](#themes)
- [Development](#development)
- [License](#license)

## Why

Manually restyling every shape in a `.drawio` file — fills, strokes,
fonts, corner radius, edge arrows — is tedious and error-prone, and
generic "convert to X" tools tend to mangle geometry, connections, or
shape semantics (a database cylinder becoming a plain rectangle, for
example). `drawio-themer` rewrites only presentational style
properties via a small YAML theme, leaving everything else — layout,
connections, embedded images/icons, shape types — untouched.

## Features

- **Safe by construction** — a style-property allow-list (see
  [`docs/PRD.md`](docs/PRD.md#10-style-allow-list)) guarantees geometry,
  topology, and shape type are never rewritten.
- **Semantic classification** — nodes, edges, containers, and database
  shapes are classified automatically and themed with distinct rules.
- **Multi-page & compressed diagrams** — supports both inline and
  `raw-deflate` + base64 compressed page content.
- **Idempotent** — re-applying a theme to an already-themed file is a
  no-op.
- **Bundled themes** — ships with 10 built-in themes covering light
  and dark, muted and vibrant, professional and accessibility-first
  styles (`shadcn-modern`, `dark-neon-mode`, `nord`, `dracula`,
  `solarized-light`, `gruvbox`, `catppuccin-mocha`, `monokai`,
  `github-light`, `high-contrast`); write your own in a few lines of
  YAML.

## Install

```sh
npm install
npm run build
```

To use the `drawio-themer` command directly (instead of `node dist/cli.js`),
install it globally after building:

```sh
make install-global
```

## Usage

```sh
drawio-themer apply input.drawio -t shadcn-modern -o output.drawio
```

Or without a global install, run the built CLI directly:

```sh
node dist/cli.js apply input.drawio -t shadcn-modern -o output.drawio
```

Or during development, without a build step:

```sh
npx tsx src/cli.ts apply input.drawio -t shadcn-modern -o output.drawio
```

### Options

```
drawio-themer apply <input>
Options:
  -t, --theme <theme>       Built-in theme name or theme file
  -o, --output <file>       Output .drawio file
      --dry-run             Analyze without writing
      --format <format>     preserve | compressed | uncompressed
      --verbose             Show matching/transformation details
      --no-theme-metadata   Do not annotate generated file
  -h, --help
```

## Themes

A theme is a YAML file of design tokens plus a small set of rules
matched against classified cells (`node`, `edge`, `container`,
`database`) or explicit tags. Ten themes are bundled:

- [`shadcn-modern`](src/themes/shadcn-modern.yaml) — light,
  shadcn/ui-inspired default
- [`dark-neon-mode`](src/themes/dark-neon-mode.yaml) — dark zinc base
  with a violet/cyan glow accent (shown in the demo above)
- [`nord`](src/themes/nord.yaml) — cool arctic blues, muted,
  professional-dark
- [`dracula`](src/themes/dracula.yaml) — vibrant purple/pink/green
  dark
- [`solarized-light`](src/themes/solarized-light.yaml) — warm cream,
  low-contrast, eye-friendly
- [`gruvbox`](src/themes/gruvbox.yaml) — warm retro browns/oranges,
  dark
- [`catppuccin-mocha`](src/themes/catppuccin-mocha.yaml) — soft
  pastel dark
- [`monokai`](src/themes/monokai.yaml) — classic yellow/green/pink
  code-editor dark
- [`github-light`](src/themes/github-light.yaml) — clean
  corporate/professional light
- [`high-contrast`](src/themes/high-contrast.yaml) — WCAG-AA-oriented
  black/white/yellow, accessibility-first

See [`docs/PRD.md`](docs/PRD.md) for the full theme format and style
allow-list.

## Development

Common tasks are wrapped in a `Makefile` with a dependency chain
(`format-check` -> `lint` -> `build`/`test` -> `run` -> `release-*`), so
each target re-verifies the gates before it:

```sh
make format          # prettier --write (mutates files)
make format-check    # prettier --check (CI-safe, no mutation)
make lint            # format-check + eslint
make test            # lint + build + vitest
make run             # test + `node dist/cli.js --version`
make install-global  # build + `npm install -g .` (adds `drawio-themer` to PATH)
make release-patch   # run + npm version patch + git push --follow-tags
make release-minor   # run + npm version minor + git push --follow-tags
make release-major   # run + npm version major + git push --follow-tags
```

Plain npm scripts are also available (`npm run build|lint|test|format|format:check`).

CI runs `make format-check`, `make lint`, and `make test` as separate
required checks (`Checks / Format`, `Checks / Lint`, `Checks / Tests`)
on every pull request.

## License

[MIT](LICENSE)

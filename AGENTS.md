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

| Target | Depends on | What it does |
|---|---|---|
| `install` | `node_modules` (auto, keyed on `package.json`/`package-lock.json`) | `npm install` |
| `format` | `install` | `prettier --write .` (mutates files) |
| `format-check` | `install` | `prettier --check .` (non-mutating, CI-safe) |
| `lint` | `format-check` | `eslint .` |
| `build` | `install` | `tsc` + copies `src/themes/*.yaml` into `dist/themes` |
| `test` | `lint`, `build` | `vitest run` |
| `run` | `test` | `node dist/cli.js --version` |
| `release-patch` | `run` | `npm version patch` + `git push --follow-tags` |
| `release-minor` | `run` | `npm version minor` + `git push --follow-tags` |
| `release-major` | `run` | `npm version major` + `git push --follow-tags` |
| `release` | `release-patch` | Alias for the default (patch) release bump |
| `clean` | — | `rm -rf dist` |

CI (`.github/workflows/checks.yml`) runs `make format-check`, `make lint`,
and `make test` as three independent required checks (`Checks / Format`,
`Checks / Lint`, `Checks / Tests`) on every pull request.

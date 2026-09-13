# drawio-themer

Apply modern visual themes to existing draw.io / diagrams.net files.

> Status: milestone-1 PoC. `apply` parses `.drawio` files (inline and
> compressed pages, multi-page), classifies cells, and applies a YAML
> theme's rules while preserving geometry, topology, and shape semantics.

## Usage

```sh
npm install
npm run build
node dist/cli.js apply input.drawio -t shadcn-modern -o output.drawio
```

Or during development:

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

## Development

Common tasks are wrapped in a `Makefile` with a dependency chain
(`format-check` -> `lint` -> `build`/`test` -> `run` -> `release-*`), so
each target re-verifies the gates before it:

```sh
make format         # prettier --write (mutates files)
make format-check    # prettier --check (CI-safe, no mutation)
make lint            # format-check + eslint
make test            # lint + build + vitest
make run             # test + `node dist/cli.js --version`
make release-patch    # run + npm version patch + git push --follow-tags
make release-minor    # run + npm version minor + git push --follow-tags
make release-major    # run + npm version major + git push --follow-tags
```

Plain npm scripts are also available (`npm run build|lint|test|format|format:check`).

CI runs `make format-check`, `make lint`, and `make test` as separate
required checks (`Checks / Format`, `Checks / Lint`, `Checks / Tests`)
on every pull request.

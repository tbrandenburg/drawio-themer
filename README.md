# drawio-themer

Apply modern visual themes to existing draw.io / diagrams.net files.

> Status: Phase 1 (CLI skeleton). The `apply` command currently performs a
> byte-passthrough copy of the input file — no XML parsing or theming logic
> is implemented yet.

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

```sh
npm run build   # compile TypeScript
npm run lint    # eslint
npm test        # vitest
```

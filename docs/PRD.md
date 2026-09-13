drawio-themer

Product Requirements Document and Implementation Plan

Status: PoC
Implementation: Node.js / TypeScript CLI
Working name: drawio-themer
Primary command:

drawio-themer apply architecture.drawio \
  --theme shadcn-modern \
  --output architecture.themed.drawio

⸻

1. Problem

draw.io / diagrams.net is attractive for technical documentation because diagrams:

* remain editable;
* can be stored in Git;
* can be generated and manipulated programmatically;
* have a well-defined XML representation;
* can be exported automatically in CI.

Its default visual appearance, however, often looks dated compared with modern web interfaces built with Tailwind CSS, shadcn/ui, Linear-style design systems, and contemporary React component libraries.

There is no mature equivalent of:

drawio-themer input.drawio --theme modern

that takes an existing diagram, preserves its structure and geometry, and applies a coherent visual design system.

drawio-themer fills that gap.

⸻

2. Product Goal

Transform an existing .drawio file into a visually coherent themed .drawio file without changing the logical diagram.

Given:

architecture.drawio

run:

drawio-themer apply architecture.drawio \
  --theme shadcn-modern \
  -o architecture.themed.drawio

The output must preserve:

* pages;
* nodes;
* edges;
* node IDs;
* source/target connections;
* positions;
* dimensions;
* edge waypoints;
* labels;
* groups;
* layers;
* metadata;
* images/icons.

It may modify only presentation-related properties.

The resulting file must remain fully editable in draw.io.

⸻

3. Design Inspiration

The default bundled theme should be inspired by current Tailwind CSS and shadcn/ui rather than by classic diagramming software.

Tailwind CSS v4 models visual decisions as reusable theme variables/design tokens for color, typography, shadows, spacing, and related properties. (tailwindcss.com)

shadcn/ui adds a particularly useful semantic layer with tokens including:

background
foreground
card
card-foreground
primary
primary-foreground
secondary
secondary-foreground
muted
muted-foreground
accent
accent-foreground
destructive
border
ring
radius

This semantic-token approach should inspire the compiler’s theme model. (shadcn/ui)

The default style should resemble a restrained modern React application rather than an illustrated presentation:

* neutral surfaces;
* subtle borders;
* limited accent colors;
* rounded corners;
* almost no gradients;
* restrained shadows;
* strong typography hierarchy;
* muted edges;
* spacious labels;
* semantic status colors.

The initial visual direction should be closest to contemporary shadcn/ui + Tailwind, using Zinc/Neutral surfaces and a restrained Indigo/Blue accent.

⸻

4. Non-goals for the PoC

The PoC will not:

* alter diagram geometry;
* automatically improve layout;
* reroute edges;
* resize nodes;
* replace icons;
* convert diagrams to Mermaid/D2;
* provide a GUI;
* implement the entire CSS cascade;
* execute arbitrary Tailwind classes;
* require Tailwind CSS itself;
* modify embedded images;
* guarantee semantic recognition of every draw.io shape;
* generate SVG/PNG/PDF.

Rendering/export remains the responsibility of draw.io or an existing draw.io CLI/export pipeline.

⸻

5. Core User Stories

US-1 — Apply bundled theme

As a developer, I can run:

drawio-themer apply input.drawio \
  --theme shadcn-modern \
  -o output.drawio

and receive an editable modern-looking diagram.

US-2 — Apply custom theme

drawio-themer apply input.drawio \
  --theme ./themes/company.yaml \
  -o output.drawio

US-3 — Use in CI

drawio-themer apply docs/source.drawio \
  --theme ./docs/theme.yaml \
  --output build/source.drawio

must run non-interactively and return a non-zero exit code on failure.

US-4 — Preserve original file

Input is never modified unless the user explicitly provides:

--in-place

--in-place may be deferred until immediately after the basic PoC.

US-5 — Preview transformation

drawio-themer apply architecture.drawio \
  --theme shadcn-modern \
  --dry-run

prints transformation statistics without writing an output file.

⸻

6. CLI Design

Initial interface:

drawio-themer apply <input>
Options:
  -t, --theme <theme>       Built-in theme name or theme file
  -o, --output <file>       Output .drawio file
      --dry-run             Analyze without writing
      --format <format>     preserve | compressed | uncompressed
      --verbose             Show matching/transformation details
      --no-theme-metadata   Do not annotate generated file
  -h, --help

Examples:

drawio-themer apply architecture.drawio \
  --theme shadcn-modern \
  -o architecture.modern.drawio
drawio-themer apply legacy.drawio \
  -t ./company-theme.yaml \
  -o modern.drawio
drawio-themer apply input.drawio \
  -t shadcn-modern \
  --format uncompressed \
  -o docs/architecture.drawio

Future commands may include:

drawio-themer themes
drawio-themer inspect input.drawio
drawio-themer validate theme.yaml
drawio-themer init-theme

They are not necessary for the first functional milestone.

⸻

7. Input Format

The compiler must support normal .drawio files containing:

<mxfile>
  <diagram>
    <mxGraphModel>
      ...
    </mxGraphModel>
  </diagram>
</mxfile>

and compressed diagram pages.

This is important because draw.io normally saves compressed page contents. Files saved by the actual draw.io editor are compressed by default; only hand-written or generated test XML tends to be uncompressed. Compressed-page support is therefore a **mandatory requirement of milestone 1**, not a later enhancement — without it, the CLI would appear to work against synthetic fixtures while failing on the large majority of real-world `.drawio` files.

The documented compression scheme is:

1. serialize mxGraphModel XML;
2. URI-encode;
3. raw-DEFLATE;
4. Base64 encode.

The compiler must support decoding and encoding this representation. (draw.io)

Multi-page .drawio files must work.

⸻

8. draw.io Style Model

draw.io represents visual styling primarily as a semicolon-separated style attribute:

<mxCell
  vertex="1"
  style="rounded=1;fillColor=#ffffff;strokeColor=#e2e8f0;"
/>

The official format is essentially:

key=value;
key=value;
bareStyleToken;

and colors are represented as values such as #RRGGBB. (draw.io)

The compiler therefore operates on parsed style maps rather than rewriting arbitrary XML.

Example parser result:

{
  tokens: ["rounded"],
  properties: {
    whiteSpace: "wrap",
    html: "1",
    fillColor: "#ffffff",
    strokeColor: "#e2e8f0"
  }
}

The serializer turns this back into a valid draw.io style string.

⸻

9. Golden Rule: Preserve Semantics

The transformer must never blindly replace the entire style string.

For example:

shape=cylinder3

contains semantic information.

Replacing it with:

rounded=1

would turn a database into a rectangle.

Instead:

shape=cylinder3;
fillColor=#dae8fc;
strokeColor=#6c8ebf;
fontColor=#000000;

becomes approximately:

shape=cylinder3;
fillColor=#fafafa;
strokeColor=#d4d4d8;
fontColor=#18181b;
strokeWidth=1;

The shape remains a cylinder.

⸻

10. Style Property Policy

Only known visual properties are overridden.

Initial allow-list:

fillColor
gradientColor
strokeColor
strokeWidth
fontColor
fontFamily
fontSize
fontStyle
rounded
arcSize
shadow
opacity
fillOpacity
strokeOpacity
spacing
spacingTop
spacingRight
spacingBottom
spacingLeft
endArrow
startArrow
endFill
startFill
dashed
dashPattern

Properties affecting topology, geometry, shape type, layout, embedding, or behavior must normally be preserved.

Examples:

shape
edgeStyle
perimeter
container
swimlane
image
imageAspect
rotation
direction
flipH
flipV

Theme rules may eventually opt into some of these, but the PoC should be conservative.

⸻

11. Classification

The compiler needs a small draw.io-aware classification system.

Every cell receives zero or more internal classes.

Edge

cell.getAttribute("edge") === "1"

→

edge

Generic node

vertex === "1"

→

node

Text

Detected from:

text;

or obvious label-only styling.

→

text

Container

Examples include swimlanes and known container styles.

→

container

Image

Cells containing image-based shape properties.

→

image

Images should not receive normal node fill/stroke rules by default.

Database

Known cylinder/database shapes.

→

database

Semantic metadata

If an <object> or <UserObject> exposes metadata such as:

<UserObject
  id="service-1"
  role="service"
  tags="backend critical">

the compiler should expose:

role:service
tag:backend
tag:critical

for matching.

This enables explicit semantic theming without embedding styling decisions into the diagram.

⸻

12. Theme Format

Use YAML for human-authored themes.

Example:

name: shadcn-modern
version: 1
tokens:
  background: "#ffffff"
  foreground: "#18181b"
  card: "#ffffff"
  cardForeground: "#18181b"
  muted: "#f4f4f5"
  mutedForeground: "#71717a"
  border: "#e4e4e7"
  primary: "#4f46e5"
  primaryForeground: "#ffffff"
  destructive: "#dc2626"
  edge: "#a1a1aa"
  radius: 12
defaults:
  fontFamily: Inter
  fontSize: 14
  strokeWidth: 1
rules:
  - selector:
      kind: node
    style:
      fillColor: "$card"
      strokeColor: "$border"
      fontColor: "$cardForeground"
      rounded: 1
      arcSize: "$radius"
      whiteSpace: wrap
      shadow: 0
  - selector:
      kind: edge
    style:
      strokeColor: "$edge"
      strokeWidth: 1.5
      rounded: 1
      endArrow: block
      endFill: 1
  - selector:
      kind: container
    style:
      fillColor: "$muted"
      strokeColor: "$border"
      fontColor: "$foreground"
  - selector:
      kind: database
    style:
      fillColor: "#fafafa"
      strokeColor: "#d4d4d8"
  - selector:
      tag: primary
    style:
      strokeColor: "$primary"
      strokeWidth: 2
   - selector:
      tag: destructive
    style:
      fillColor: "#fef2f2"
      strokeColor: "$destructive"
      fontColor: "#991b1b"

An optional top-level `previewGlow: true` field (default `false`) is a
preview-rendering hint only, added alongside issue #5's `--png-themed`
flag - it is not a style token and is never consumed by the
compiler/matcher/transform pipeline. It tells the offline PNG preview
renderer (`src/render/previewSvg.ts`) whether to draw a soft glow filter
around edges/cylinders/container borders. Reserve it for vibrant/
neon-leaning dark themes (`dark-neon-mode`, `dracula`, `monokai`); leave
it unset/`false` for muted, light, retro, or accessibility-focused
themes where a glow would clash with the intended aesthetic.

⸻

13. Why Semantic Tokens Instead of Raw Tailwind Utilities

The initial compiler should not interpret arbitrary syntax like:

bg-zinc-50
border-zinc-200
rounded-xl
shadow-sm

Internally, the theme model should instead use semantic tokens.

Reasons:

1. smaller implementation;
2. no dependency on Tailwind’s CSS compiler;
3. deterministic conversion to draw.io properties;
4. easier custom company themes;
5. permits non-Tailwind themes;
6. removes coupling to Tailwind implementation details.

A later convenience layer can accept Tailwind-like utility names and compile them into the same internal token model.

⸻

14. Default Bundled Theme: shadcn-modern

The PoC ships with one polished theme.

Recommended visual language:

Canvas

background: #ffffff

Cards / regular nodes

fill:       #ffffff
border:     #e4e4e7
text:       #18181b
border:     1px
radius:     ~10–12px
shadow:     none

Secondary/container surface

fill:       #fafafa or #f4f4f5
border:     #e4e4e7
text:       #3f3f46

Muted text

#71717a

Edges

#9ca3af / #a1a1aa

with restrained arrowheads.

Primary accent

Indigo:

#4f46e5

used sparingly.

Success

surface: #f0fdf4
border:  #86efac
text:    #166534

Warning

surface: #fffbeb
border:  #fcd34d
text:    #92400e

Error

surface: #fef2f2
border:  #fca5a5
text:    #991b1b

The theme should prioritize neutral hierarchy over colorful boxes.

⸻

15. Cascading

Rules are evaluated in order.

Example:

rules:
  - selector:
      kind: node
  - selector:
      kind: database
  - selector:
      tag: primary

A primary database receives:

node defaults
    ↓
database overrides
    ↓
primary overrides

Last applicable rule wins for each property.

This gives enough CSS-like behavior without implementing CSS.

⸻

16. Theme Resolution Pipeline

Conceptual pipeline:

Theme YAML
    │
    ▼
parse
    │
    ▼
Zod validation
    │
    ▼
resolve token references
    │
    ▼
CompiledTheme

Example internal form:

interface CompiledTheme {
  name: string;
  defaults: StyleMap;
  rules: CompiledRule[];
}

A reference such as:

strokeColor: "$border"

resolves before cells are transformed.

Missing token references are fatal validation errors.

⸻

17. Diagram Transformation Pipeline

input.drawio
      │
      ▼
read file
      │
      ▼
parse outer XML
      │
      ▼
for each <diagram>
      │
      ├─ inline XML ──────┐
      │                    │
      └─ compressed ─► decode/decompress
                           │
                           ▼
                    mxGraphModel DOM
                           │
                           ▼
                    enumerate cells
                           │
                           ▼
                       classify
                           │
                           ▼
                    match theme rules
                           │
                           ▼
                    parse current style
                           │
                           ▼
                merge allowed properties
                           │
                           ▼
                  serialize style string
                           │
                           ▼
                serialize mxGraphModel
                           │
                           ▼
             recompress if required
                           │
                           ▼
                    write output

⸻

18. Output Encoding

CLI option:

--format preserve

should be the default.

Meaning:

* compressed page → compressed page;
* uncompressed page → uncompressed page.

Also support:

--format compressed

and:

--format uncompressed

uncompressed is particularly useful for Git repositories because XML changes become reviewable.

⸻

19. Suggested Technology Stack

Target:

Node.js 24+ (current Active LTS)
TypeScript 5.9.x (pinned; do not use TypeScript 7.x — see note below)
ESM

Version pinning rationale (verified against npm on 2026-09-13):

* Node.js 24+ is required because `commander@15` (`engines.node >=22.12.0`), `vitest@5` (`engines.node ^22.12.0 || ^24.0.0 || >=26.0.0`), and `eslint@10` (`engines.node ^20.19.0 || ^22.13.0 || >=24`) only overlap cleanly at Node 24+; Node 22 is now Maintenance LTS and sits in a narrow, fragile compatibility window.
* TypeScript must stay on the 5.9.x line (latest: 5.9.3). TypeScript 7.x is a new Go-native rewrite that `typescript-eslint` does not yet support — its peer dependency range is `typescript >=4.8.4 <6.1.0`, which explicitly excludes 7.x. TypeScript 6.x exists (6.0.3) but is a single-release, unproven branch; prefer the mature 5.9.x line for this project.
* ESLint must use flat config (`eslint.config.js`); the legacy `.eslintrc` format is no longer supported starting with ESLint 9+.
* Use the unified `typescript-eslint` meta-package (`^8.70.0`) rather than wiring `@typescript-eslint/parser`/`@typescript-eslint/eslint-plugin` separately.

Suggested dependencies:

commander (^15)
@xmldom/xmldom (^0.9)
pako (^3)
yaml (^2.9)
zod (^4)

Development dependencies:

typescript (5.9.x, pinned — not 7.x)
tsx
vitest (^5)
eslint (^10) with flat config
typescript-eslint (^8.70)
prettier

Optional:

tsup

for producing a compact distributable CLI.

Commander

Use for CLI parsing/help/error handling.

Commander directly supports TypeScript and provides a mature command/subcommand model. (GitHub)

@xmldom/xmldom

DOM-style parsing is preferable for the PoC because transformations target a small number of XML elements and attributes while arbitrary existing XML needs to survive.

pako

Use for draw.io’s raw DEFLATE representation. The official draw.io documentation itself demonstrates the format using pako.deflateRaw. (draw.io)

Zod

Validate theme configuration before touching the document. Target Zod 4's current API — do not copy Zod 3 patterns (error-map/`.strict()`/`.default()` semantics changed between major versions).

YAML

Human-readable theme format.

Vitest

Unit and golden-file tests.

⸻

20. Project Structure

drawio-themer/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
│
├── src/
│   ├── cli.ts
│   │
│   ├── commands/
│   │   └── apply.ts
│   │
│   ├── drawio/
│   │   ├── document.ts
│   │   ├── compression.ts
│   │   ├── styles.ts
│   │   ├── classifier.ts
│   │   └── transform.ts
│   │
│   ├── theme/
│   │   ├── schema.ts
│   │   ├── loader.ts
│   │   ├── compiler.ts
│   │   └── matcher.ts
│   │
│   ├── themes/
│   │   └── shadcn-modern.yaml
│   │
│   └── types.ts
│
└── test/
    ├── fixtures/
    │   ├── simple.drawio
    │   ├── compressed.drawio
    │   ├── multipage.drawio
    │   ├── groups.drawio
    │   └── architecture.drawio
    │
    ├── styles.test.ts
    ├── compression.test.ts
    ├── classifier.test.ts
    ├── theme.test.ts
    ├── transform.test.ts
    └── golden.test.ts

⸻

21. Core TypeScript Interfaces

export type StyleMap = Record<string, string>;
export interface ParsedStyle {
  tokens: string[];
  properties: StyleMap;
}
export type CellKind =
  | "node"
  | "edge"
  | "text"
  | "container"
  | "database"
  | "image";
export interface CellDescriptor {
  id: string;
  kind: CellKind;
  shape?: string;
  tags: string[];
  metadata: Record<string, string>;
}
export interface ThemeSelector {
  kind?: CellKind;
  shape?: string;
  tag?: string;
  metadata?: Record<string, string>;
}
export interface ThemeRule {
  selector: ThemeSelector;
  style: StyleMap;
}
export interface Theme {
  name: string;
  version: number;
  tokens: Record<string, string | number>;
  defaults: StyleMap;
  rules: ThemeRule[];
}

⸻

22. Style Parser

Input:

rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;

Output:

{
  tokens: [],
  properties: {
    rounded: "1",
    whiteSpace: "wrap",
    html: "1",
    fillColor: "#dae8fc"
  }
}

Input:

ellipse;whiteSpace=wrap;html=1;

Output:

{
  tokens: ["ellipse"],
  properties: {
    whiteSpace: "wrap",
    html: "1"
  }
}

The serializer must preserve bare tokens.

⸻

23. Style Merging

Pseudo-code:

function themeCell(
  cell: CellDescriptor,
  current: ParsedStyle,
  theme: CompiledTheme,
): ParsedStyle {
  const result = clone(current);
  for (const rule of theme.rules) {
    if (!matches(cell, rule.selector)) continue;
    for (const [property, value] of Object.entries(rule.style)) {
      if (!THEMEABLE_PROPERTIES.has(property)) continue;
      result.properties[property] = value;
    }
  }
  return result;
}

The operation should be idempotent.

Running:

drawio-themer apply themed.drawio ...

twice should produce the same styles as running it once.

⸻

24. Metadata

Optionally annotate the outer document:

<mxfile
  drawio-themer="shadcn-modern"
  drawio-themer-version="1">

or equivalent safe metadata.

This is useful for CI diagnostics but must not be required for re-theming.

⸻

25. Statistics

After a successful transformation:

✓ Theme: shadcn-modern
✓ Pages: 3
✓ Cells inspected: 84
✓ Nodes themed: 36
✓ Containers themed: 5
✓ Databases themed: 4
✓ Edges themed: 37
✓ Cells skipped: 2
✓ Output: architecture.themed.drawio

With:

--verbose

include selector information:

service-api
  node
  tag:primary
  changed fillColor, strokeColor, fontColor, arcSize

⸻

26. Error Handling

Exit 0:

* successful transformation.

Exit non-zero:

* input missing;
* malformed XML;
* invalid compressed page;
* invalid theme YAML;
* unknown token reference;
* output cannot be written.

Never silently create a partially transformed document after a fatal parse error.

Prefer:

Error: Page "Deployment" could not be decompressed.
No output was written.

⸻

27. Test Strategy

Unit tests

Style parsing

Test:

key=value
bare tokens
empty style
trailing semicolon
unknown properties

Compression

Assert:

xml
→ compress
→ decompress
→ same XML

using draw.io’s documented algorithm.

Theme compilation

Test:

token resolution
unknown tokens
rule ordering
schema errors

Selector matching

Test:

kind
shape
tag
metadata
combined selectors

Transformation tests

Verify that styling changes while geometry does not.

For a fixture, capture before/after values of:

id
parent
source
target
x
y
width
height
mxPoint

and assert equality.

Golden files

Maintain several checked-in examples:

fixture.drawio
fixture.expected.drawio

This will catch serialization and cascading regressions.

⸻

28. Acceptance Criteria for the PoC

The PoC is successful when all of the following work:

AC-1

drawio-themer apply input.drawio \
  -t shadcn-modern \
  -o output.drawio

creates a valid file that opens in diagrams.net.

AC-2

At least these elements receive appropriate styling:

regular nodes
text
containers
database/cylinder shapes
edges

AC-3

Connections and geometry are unchanged.

AC-4

Compressed input works.

AC-5

Multi-page diagrams work.

AC-6

Custom YAML theme files work.

AC-7

Repeated application is idempotent.

AC-8

Images/icons survive unchanged.

AC-9

At least one realistic architecture diagram changes visibly from classic draw.io styling into a coherent modern neutral style.

⸻

29. Implementation Plan

Phase 1 — CLI skeleton

Implement:

package setup
TypeScript
Commander
apply command
input/output arguments
error handling

Expected executable:

npx drawio-themer apply test.drawio \
  -t shadcn-modern \
  -o out.drawio

No styling yet.

⸻

Phase 2 — Draw.io document loader

Implement:

loadDrawioDocument()
getPages()
serializeDrawioDocument()

Support both:

inline mxGraphModel
compressed diagram contents

Test multi-page round trips before styling anything.

This is the highest-risk foundational part. Compressed-page support must ship in milestone 1: it is required, not optional, since most real draw.io files use compressed page content.

⸻

Phase 3 — Style parser

Implement:

parseStyle()
serializeStyle()
mergeStyle()

Do not perform XML-specific logic here.

Make this small and thoroughly tested.

⸻

Phase 4 — Cell classifier

Implement:

classifyCell()

PoC recognition:

edge
image
text
container
database
node

Priority matters:

image
text
container
database
edge
node

rather than classifying every vertex as merely node.

⸻

Phase 5 — Theme schema/compiler

Implement YAML loading and Zod schema validation.

Pipeline:

YAML
 ↓
ThemeSchema
 ↓
token resolver
 ↓
CompiledTheme

Implement selectors:

kind
shape
tag
metadata

No boolean selector expressions yet.

⸻

Phase 6 — Transformer

For each eligible cell:

parse
classify
match
merge
serialize

Build protection around semantic style properties.

Add transformation statistics.

⸻

Phase 7 — shadcn-modern

Create the bundled theme and tune it manually against three representative diagrams:

1. simple flowchart;
2. service architecture diagram;
3. infrastructure/cloud diagram.

Do not optimize against only synthetic fixtures.

Theme tuning is part of the product, not merely test data.

⸻

Phase 8 — Golden integration tests

Add real fixtures containing:

groups
swimlanes
database shapes
orthogonal edges
icons
multiple pages
compressed pages
HTML labels
custom metadata

Open generated golden outputs manually in draw.io as a final sanity test.

⸻

30. Suggested First Implementation Sequence

An implementation agent should work in this exact order:

1. Scaffold CLI
2. Build compression/decompression
3. Build document round-trip
4. Build style parser/serializer
5. Add cell enumeration
6. Add classification
7. Add YAML schema
8. Add token resolution
9. Add rule matching
10. Add style transformation
11. Add bundled theme
12. Add CLI statistics
13. Add golden tests
14. Tune visual theme

Do not begin with sophisticated theme syntax.

The difficult part is safe transformation of arbitrary existing draw.io documents.

⸻

31. Future Work

Once the PoC is stable, the architecture should permit these additions.

Tailwind utility compatibility

Example:

classes:
  service:
    - bg-white
    - text-zinc-950
    - border-zinc-200
    - rounded-xl

compiled internally into draw.io properties.

Tailwind CSS v4 import

Potential input:

@theme {
  --color-brand-500: ...;
}

Tailwind v4 deliberately exposes design tokens as CSS theme variables, making this feasible later. (tailwindcss.com)

shadcn theme import

shadcn already represents themes using semantic CSS variables and supports reusable theme definitions/presets. (shadcn/ui)

Modern shadcn/Tailwind themes increasingly express design tokens in OKLCH (e.g. `oklch(0.205 0 0)`), while draw.io's documented style format only accepts concrete `#RRGGBB` values. A shadcn/Tailwind importer must therefore include an explicit **color-resolution step** — parsing CSS color values (OKLCH, LCH, HSL, etc.) and converting them to hex, likely via a library such as [culori](https://culorijs.org/) (`^4.0`, current stable, `engines.node: ^12.20.0 || ^14.13.1 || >=16.0.0`, compatible with the Node 24+ baseline) — that runs before the theme reaches the transformer. The transformer itself must never see anything but resolved hex colors.

Potential future command:

drawio-themer apply architecture.drawio \
  --shadcn ./globals.css

The importer would resolve CSS/OKLCH colors to concrete draw.io-compatible hex colors using this resolution step.

Dark mode

drawio-themer apply architecture.drawio \
  --theme shadcn-modern-dark

Theme migration

drawio-themer apply diagram.drawio \
  --from shadcn-modern \
  --theme company-v2

Inspection

drawio-themer inspect architecture.drawio

could output:

Shapes:
  rectangle: 21
  cylinder3: 4
  image: 8
Tags:
  service: 14
  external: 3

HTML report

Generate a before/after styling report suitable for CI artifacts.

⸻

32. Potential V2 Feature: Tailwind-like Classes in Draw.io

A particularly attractive extension is allowing semantic tags or metadata to contain style classes:

<UserObject
  label="Billing API"
  tags="service primary">

with external mapping:

classes:
  service:
    apply:
      - card
      - rounded-lg
  primary:
    apply:
      - border-primary

Or eventually:

tw:bg-card
tw:text-card-foreground
tw:border-border
tw:rounded-xl

The implementation should keep this layer separate from the core transformer.

The core understands only resolved draw.io styles.

Conceptually:

Tailwind syntax
      │
      ▼
utility compiler
      │
      ▼
ThemeRule[]
      │
      ▼
draw.io transformer

This separation keeps the core reusable.

⸻

33. Architectural Principle

The compiler should operate like a compiler rather than a formatter:

Theme source
      ↓
validate
      ↓
normalize
      ↓
compile selectors + tokens
      ↓
transform AST/DOM
      ↓
serialize

Do not scatter YAML interpretation or token expansion throughout XML manipulation code.

Similarly:

draw.io XML
      ↓
document model
      ↓
cell descriptor
      ↓
style representation

keeps format handling separate from theme semantics.

⸻

34. PoC Definition of Done

A Git repository containing:

TypeScript CLI
README
MIT/Apache-2.0 license
bundled shadcn-modern theme
theme schema
compressed draw.io support
multi-page support
unit tests
integration tests
example before/after diagrams

with a README example:

npm install
npm run build
node dist/cli.js apply \
  examples/before.drawio \
  --theme shadcn-modern \
  --output examples/after.drawio

and:

npx drawio-themer apply architecture.drawio \
  -t shadcn-modern \
  -o architecture.themed.drawio

after publication.

⸻

35. Recommended PoC Boundary

The most important scope decision is:

Do not implement Tailwind itself in v0.1.

Implement the useful 20%:

draw.io parser
+
semantic selectors
+
theme tokens
+
style cascade
+
beautiful bundled theme

That is enough to prove whether automatic restyling of existing diagrams produces consistently good results.

Once that works, Tailwind/shadcn import becomes an adapter rather than a rewrite of the compiler.

The desired architecture is therefore:

                     ┌─ YAML theme
                     │
                     ├─ shadcn importer       [future]
                     │
                     ├─ Tailwind importer     [future]
                     │
                     └─ TW utility compiler   [future]
                              │
                              ▼
                       CompiledTheme
                              │
existing.drawio ──────► Transformer
                              │
                              ▼
                       styled.drawio

This keeps the PoC small while providing a credible route toward a general-purpose draw.io theming ecosystem.
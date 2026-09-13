/**
 * Golden integration tests (PRD section 27 "Test Strategy" > golden
 * files / Phase 8).
 *
 * `test/fixtures/golden/architecture.drawio` exercises every item on
 * the PRD Phase 8 checklist in a single realistic document: groups,
 * swimlanes, a database (cylinder3) shape, orthogonal edges, an image
 * icon, two pages (one inline, one compressed), an HTML label, and
 * `<UserObject>` semantic metadata.
 *
 * Comparison strategy: we parse BOTH the actual transformer output and
 * the checked-in golden file back into `DrawioDocument`/page models via
 * `loadDrawioDocument`/`getPages`/`getModelXml`, then compare the
 * resulting mxGraphModel XML strings per page. Both strings go through
 * the exact same xmldom parse -> serialize round trip this way (the
 * golden file was itself produced by, and is re-loaded through, the
 * same code path used for the actual output), so incidental xmldom
 * serialization quirks (e.g. empty-element self-closing normalization)
 * cancel out on both sides instead of causing false-positive diffs.
 * This is deliberately not raw string equality against the file on
 * disk - only against the re-parsed/re-serialized form - since that
 * fully isolates "did the real transformation change" from "does
 * xmldom format things slightly differently than a hand-authored file".
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { transformDrawioXml } from "../src/drawio/transform.js";
import { loadDrawioDocument, getPages } from "../src/drawio/document.js";
import { loadTheme } from "../src/theme/loader.js";
import { compileTheme } from "../src/theme/compiler.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "golden", "architecture.drawio");
const EXPECTED = join(import.meta.dirname, "fixtures", "golden", "architecture.expected.drawio");
const THEME_PATH = join(import.meta.dirname, "..", "src", "themes", "shadcn-modern.yaml");

async function runTransform() {
  const [inputXml, themeSource] = await Promise.all([
    readFile(FIXTURE, "utf8"),
    readFile(THEME_PATH, "utf8"),
  ]);
  const theme = compileTheme(loadTheme(themeSource));
  return transformDrawioXml(inputXml, theme, {
    format: "preserve",
    verbose: true,
    themeMetadata: true,
  });
}

/** Re-parses a `.drawio` XML string's pages, keyed by diagram `name`. */
function pagesByName(xml: string): Map<string, ReturnType<typeof getPages>[number]> {
  const doc = loadDrawioDocument(xml);
  const map = new Map<string, ReturnType<typeof getPages>[number]>();
  for (const page of getPages(doc)) {
    if (page.name) map.set(page.name, page);
  }
  return map;
}

/** Finds an `<mxCell id="...">` element (searching `<UserObject>` wrappers too) in model XML. */
function findCellStyle(modelXml: string, id: string): string | null {
  const doc = loadDrawioDocument(`<mxfile><diagram name="x">${modelXml}</diagram></mxfile>`);
  const page = getPages(doc)[0];
  const xml = page.getModelXml();
  // Simple attribute scan: works for both plain <mxCell id="x" ...> and
  // <UserObject ... id="x">child <mxCell style="..."> </UserObject> since
  // in the latter the id lives on the wrapper, not the mxCell.
  const wrapperRe = new RegExp(
    `<UserObject[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<mxCell[^>]*\\bstyle="([^"]*)"`,
  );
  const wrapperMatch = wrapperRe.exec(xml);
  if (wrapperMatch) return wrapperMatch[1];

  const plainRe = new RegExp(`<mxCell[^>]*\\bid="${id}"[^>]*\\bstyle="([^"]*)"`);
  const plainMatch = plainRe.exec(xml);
  if (plainMatch) return plainMatch[1];

  // style may appear before id in attribute order
  const reversedRe = new RegExp(`<mxCell[^>]*\\bstyle="([^"]*)"[^>]*\\bid="${id}"`);
  const reversedMatch = reversedRe.exec(xml);
  return reversedMatch ? reversedMatch[1] : null;
}

function findAttr(modelXml: string, id: string, attr: string): string | null {
  const re = new RegExp(`<mxCell[^>]*\\bid="${id}"[^>]*\\b${attr}="([^"]*)"`);
  const match = re.exec(modelXml);
  if (match) return match[1];
  const reversed = new RegExp(`<mxCell[^>]*\\b${attr}="([^"]*)"[^>]*\\bid="${id}"`);
  const reversedMatch = reversed.exec(modelXml);
  return reversedMatch ? reversedMatch[1] : null;
}

describe("golden integration: architecture.drawio", () => {
  it("matches the checked-in golden output (per-page model comparison)", async () => {
    const { outputXml } = await runTransform();
    const expectedXml = await readFile(EXPECTED, "utf8");

    const actualPages = pagesByName(outputXml);
    const expectedPages = pagesByName(expectedXml);

    expect([...actualPages.keys()].sort()).toEqual([...expectedPages.keys()].sort());

    for (const [name, actualPage] of actualPages) {
      const expectedPage = expectedPages.get(name);
      expect(expectedPage, `expected golden file missing page "${name}"`).toBeDefined();
      expect(actualPage.getModelXml(), `page "${name}" model XML differs`).toBe(
        expectedPage!.getModelXml(),
      );
    }
  });

  it("prints the same statistics as the checked-in manual run (regression trip-wire)", async () => {
    const { stats } = await runTransform();
    expect(stats.themeName).toBe("shadcn-modern");
    expect(stats.pages).toBe(2);
    expect(stats.cellsInspected).toBe(13);
    // Skipped: the image icon (no theme rule targets "image") and the
    // group cell (classified as "group", no theme rule targets it either
    // - draw.io's invisible structural grouping cells must not receive
    // visible node fill/border theming; see classifier.ts's `isGroup`).
    expect(stats.cellsSkipped).toBe(2);
    expect(stats.themedByClass).toEqual({
      node: 7,
      container: 1,
      database: 1,
      edge: 2,
    });
  });
});

describe("golden integration: per-item PRD Phase 8 checklist assertions", () => {
  it("preserves the group cell's parent relationships (group + 2 children) and leaves its own style untouched", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Frontend")!;
    const xml = page.getModelXml();

    expect(findAttr(xml, "grp1", "parent")).toBe("1");
    expect(findAttr(xml, "grpChild1", "parent")).toBe("grp1");
    expect(findAttr(xml, "grpChild2", "parent")).toBe("grp1");
    // The group cell itself must stay untouched - draw.io's invisible
    // structural grouping cells (style="group", connectable="0") must
    // not gain visible fill/border theming (PRD section 9 "Golden Rule:
    // Preserve Semantics"). No theme rule targets "kind: group".
    expect(findCellStyle(xml, "grp1")).toBe("group");
    // Its children ARE themed normally (generic "node").
    expect(findCellStyle(xml, "grpChild1")).toContain("fillColor=#ffffff");
  });

  it("preserves the swimlane's container/swimlane semantics, child parent links, and themes it as a container", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Frontend")!;
    const xml = page.getModelXml();

    const laneStyle = findCellStyle(xml, "lane1")!;
    expect(laneStyle).toContain("swimlane");
    expect(laneStyle).toContain("startSize=30");
    // container theme colors from shadcn-modern.yaml (muted / border / containerForeground)
    expect(laneStyle).toContain("fillColor=#fafafa");
    expect(laneStyle).toContain("strokeColor=#e4e4e7");
    expect(laneStyle).toContain("fontColor=#3f3f46");

    expect(findAttr(xml, "laneChild1", "parent")).toBe("lane1");
    expect(findAttr(xml, "laneChild2", "parent")).toBe("lane1");
  });

  it("keeps shape=cylinder3 on the database cell and themes it with database colors", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Backend")!;
    const xml = page.getModelXml();

    const dbStyle = findCellStyle(xml, "db1")!;
    expect(dbStyle).toContain("shape=cylinder3");
    expect(dbStyle).toContain("fillColor=#fafafa");
    expect(dbStyle).toContain("strokeColor=#d4d4d8");
  });

  it("keeps edgeStyle=orthogonalEdgeStyle on edges and themes them with edge colors", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Backend")!;
    const xml = page.getModelXml();

    for (const id of ["e1", "e2"]) {
      const style = findCellStyle(xml, id)!;
      expect(style).toContain("edgeStyle=orthogonalEdgeStyle");
      expect(style).toContain("strokeColor=#a1a1aa");
      expect(style).toContain("endArrow=block");
    }
  });

  it("leaves the image cell's shape/image untouched and does not apply node fill/stroke to it", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Frontend")!;
    const xml = page.getModelXml();

    const iconStyle = findCellStyle(xml, "icon1")!;
    expect(iconStyle).toContain("shape=image");
    expect(iconStyle).toContain("image=https://example.com/icon.png");
    expect(iconStyle).not.toContain("fillColor");
    expect(iconStyle).not.toContain("strokeColor");
  });

  it("keeps both pages present, one compressed and one inline, under --format preserve", async () => {
    const { outputXml } = await runTransform();
    const doc = loadDrawioDocument(outputXml);
    const pages = getPages(doc);
    expect(pages).toHaveLength(2);

    const frontend = pages.find((p) => p.name === "Frontend")!;
    const backend = pages.find((p) => p.name === "Backend")!;
    expect(frontend.compressed).toBe(false);
    expect(backend.compressed).toBe(true);
  });

  it("keeps the HTML-label cell's value byte-identical", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Frontend")!;
    const xml = page.getModelXml();

    const valueMatch = /<mxCell id="htmlLabel1" value="([^"]*)"/.exec(xml);
    expect(valueMatch).not.toBeNull();
    expect(valueMatch![1]).toBe(
      "&lt;b&gt;Bold Label&lt;/b&gt;&lt;br&gt;&lt;i&gt;italic detail&lt;/i&gt;",
    );

    const styleMatch = /<mxCell id="htmlLabel1"[^>]*style="([^"]*)"/.exec(xml);
    expect(styleMatch![1]).toContain("html=1");
  });

  it("applies the tag:primary rule (strokeColor=$primary) via the UserObject role/tags metadata", async () => {
    const { outputXml } = await runTransform();
    const page = pagesByName(outputXml).get("Backend")!;
    const xml = page.getModelXml();

    expect(xml).toContain(
      '<UserObject label="Billing API" role="service" tags="primary critical" id="svc1">',
    );
    const style = findCellStyle(xml, "svc1")!;
    expect(style).toContain("strokeColor=#4f46e5");
    expect(style).toContain("strokeWidth=2");
  });
});

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { transformDrawioXml } from "../../src/drawio/transform.js";
import { loadTheme } from "../../src/theme/loader.js";
import { compileTheme } from "../../src/theme/compiler.js";
import { getPages, loadDrawioDocument } from "../../src/drawio/document.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

async function readFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

async function loadCompiledTheme() {
  const themePath = join(import.meta.dirname, "..", "..", "src", "themes", "shadcn-modern.yaml");
  const source = await readFile(themePath, "utf8");
  return compileTheme(loadTheme(source));
}

function getMxCells(modelXml: string): Element[] {
  const doc = new DOMParser().parseFromString(modelXml, "text/xml");
  const cells = doc.getElementsByTagName("mxCell");
  const out: Element[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells.item(i);
    if (cell) out.push(cell as unknown as Element);
  }
  return out;
}

describe("transformDrawioXml", () => {
  it("themes cells while preserving geometry and shape-defining properties", async () => {
    const xml = await readFixture("simple.drawio");
    const theme = await loadCompiledTheme();

    const result = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: true,
    });

    const outputDoc = loadDrawioDocument(result.outputXml);
    const outputPage = getPages(outputDoc)[0];
    expect(outputPage).toBeDefined();
    const outputCells = getMxCells(outputPage!.getModelXml());

    const inputCells = getMxCells(
      await (async () => {
        const inputDoc = loadDrawioDocument(xml);
        return getPages(inputDoc)[0]!.getModelXml();
      })(),
    );

    const node1Before = inputCells.find((c) => c.getAttribute("id") === "node1")!;
    const node1After = outputCells.find((c) => c.getAttribute("id") === "node1")!;

    // Geometry and non-style attributes must be untouched.
    expect(node1After.getAttribute("parent")).toBe(node1Before.getAttribute("parent"));
    expect(node1After.getAttribute("vertex")).toBe(node1Before.getAttribute("vertex"));

    const geomBefore = node1Before.getElementsByTagName("mxGeometry").item(0)!;
    const geomAfter = node1After.getElementsByTagName("mxGeometry").item(0)!;
    for (const attr of ["x", "y", "width", "height"]) {
      expect(geomAfter.getAttribute(attr)).toBe(geomBefore.getAttribute(attr));
    }

    // Style should have changed (theme colors applied).
    expect(node1After.getAttribute("style")).not.toBe(node1Before.getAttribute("style"));
    expect(node1After.getAttribute("style")).toContain("fillColor=#ffffff");

    // Edge geometry / endpoints preserved.
    const edgeBefore = inputCells.find((c) => c.getAttribute("id") === "edge1")!;
    const edgeAfter = outputCells.find((c) => c.getAttribute("id") === "edge1")!;
    expect(edgeAfter.getAttribute("source")).toBe(edgeBefore.getAttribute("source"));
    expect(edgeAfter.getAttribute("target")).toBe(edgeBefore.getAttribute("target"));

    // Metadata annotation applied.
    expect(outputDoc.xmlDoc.documentElement?.getAttribute("drawio-themer")).toBe("shadcn-modern");
    expect(outputDoc.xmlDoc.documentElement?.getAttribute("drawio-themer-version")).toBe("1");

    // Stats sanity: 2 nodes + 1 edge themed, none skipped (no plain text cells in fixture).
    expect(result.stats.cellsInspected).toBe(3);
    expect(result.stats.themedByClass.node).toBe(2);
    expect(result.stats.themedByClass.edge).toBe(1);
    expect(result.stats.cellsSkipped).toBe(0);
  });

  it("preserves shape=cylinder3 semantics while re-coloring database cells (PRD Golden Rule)", async () => {
    const xml = `<mxfile><diagram id="p1" name="P1"><mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="db1" value="DB" style="shape=cylinder3;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#000000;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="80" height="80" as="geometry" />
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const theme = await loadCompiledTheme();

    const result = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: false,
    });
    const outputDoc = loadDrawioDocument(result.outputXml);
    const cell = getMxCells(getPages(outputDoc)[0]!.getModelXml()).find(
      (c) => c.getAttribute("id") === "db1",
    )!;

    expect(cell.getAttribute("style")).toContain("shape=cylinder3");
    // database shapes are themed identically to regular nodes - only the
    // cylinder geometry marks them as a database, not a distinct color.
    expect(cell.getAttribute("style")).toContain("fillColor=#ffffff");
    expect(result.stats.themedByClass.database).toBe(1);
  });

  it("is idempotent: applying twice produces the same result as applying once", async () => {
    const xml = await readFixture("simple.drawio");
    const theme = await loadCompiledTheme();

    const first = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: true,
    });
    const second = transformDrawioXml(first.outputXml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: true,
    });

    const firstModel = getPages(loadDrawioDocument(first.outputXml))[0]!.getModelXml();
    const secondModel = getPages(loadDrawioDocument(second.outputXml))[0]!.getModelXml();
    expect(secondModel).toBe(firstModel);
  });

  it("handles compressed pages and forces the requested --format", async () => {
    const xml = await readFixture("compressed.drawio");
    const theme = await loadCompiledTheme();

    const preserved = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: false,
    });
    const preservedDoc = loadDrawioDocument(preserved.outputXml);
    expect(getPages(preservedDoc)[0]!.compressed).toBe(true);

    const uncompressed = transformDrawioXml(xml, theme, {
      format: "uncompressed",
      verbose: false,
      themeMetadata: false,
    });
    const uncompressedDoc = loadDrawioDocument(uncompressed.outputXml);
    expect(getPages(uncompressedDoc)[0]!.compressed).toBe(false);
  });

  it("emits verbose per-cell detail only for themed cells", async () => {
    const xml = await readFixture("simple.drawio");
    const theme = await loadCompiledTheme();

    const result = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: true,
      themeMetadata: false,
    });
    expect(result.verboseDetails.length).toBe(3);
    const node1Detail = result.verboseDetails.find((d) => d.label === "Start");
    expect(node1Detail?.classes).toContain("node");
    expect(node1Detail?.changedProperties.length).toBeGreaterThan(0);
  });

  it("prefers the UserObject wrapper's label attribute for verbose display over the inner cell's value/id", async () => {
    const xml = `<mxfile><diagram id="p1" name="P1"><mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <UserObject label="Billing API" id="obj1">
        <mxCell style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="0" y="0" width="120" height="60" as="geometry" />
        </mxCell>
      </UserObject>
    </root></mxGraphModel></diagram></mxfile>`;
    const theme = await loadCompiledTheme();

    const result = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: true,
      themeMetadata: false,
    });

    expect(result.verboseDetails.length).toBe(1);
    expect(result.verboseDetails[0]?.label).toBe("Billing API");
  });

  it("skips cells with no matching rule instead of stamping global defaults on them", async () => {
    const xml = `<mxfile><diagram id="p1" name="P1"><mxGraphModel><root>
      <mxCell id="0" /><mxCell id="1" parent="0" />
      <mxCell id="t1" value="Label" style="text;html=1;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="80" height="20" as="geometry" />
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const theme = await loadCompiledTheme();

    const result = transformDrawioXml(xml, theme, {
      format: "preserve",
      verbose: false,
      themeMetadata: false,
    });

    expect(result.stats.cellsInspected).toBe(1);
    expect(result.stats.cellsSkipped).toBe(1);
    expect(result.stats.themedByClass.text).toBeUndefined();

    const cell = getMxCells(getPages(loadDrawioDocument(result.outputXml))[0]!.getModelXml()).find(
      (c) => c.getAttribute("id") === "t1",
    )!;
    expect(cell.getAttribute("style")).toBe("text;html=1;");
  });
});

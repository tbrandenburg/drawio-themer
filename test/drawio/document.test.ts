import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getPages,
  loadDrawioDocument,
  serializeDrawioDocument,
} from "../../src/drawio/document.js";
import { compressDiagramContent, decompressDiagramContent } from "../../src/drawio/compression.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

async function readFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

describe("loadDrawioDocument / getPages", () => {
  it("loads a single-page uncompressed document", async () => {
    const xml = await readFixture("simple.drawio");
    const doc = loadDrawioDocument(xml);
    const pages = getPages(doc);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.id).toBe("page-1");
    expect(pages[0]?.name).toBe("Page-1");
    expect(pages[0]?.compressed).toBe(false);

    const model = pages[0]?.getModelXml() ?? "";
    expect(model).toContain("<mxGraphModel");
    expect(model).toContain('id="node1"');
    expect(model).toContain('id="edge1"');
  });

  it("loads a single-page compressed document", async () => {
    const xml = await readFixture("compressed.drawio");
    const doc = loadDrawioDocument(xml);
    const pages = getPages(doc);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.compressed).toBe(true);

    const model = pages[0]?.getModelXml() ?? "";
    expect(model).toContain("<mxGraphModel");
    expect(model).toContain('id="db1"');
    expect(model).toContain('id="svc1"');
  });

  it("loads a multi-page document mixing inline and compressed pages", async () => {
    const xml = await readFixture("multipage.drawio");
    const doc = loadDrawioDocument(xml);
    const pages = getPages(doc);

    expect(pages).toHaveLength(2);

    const [inlinePage, compressedPage] = pages;
    expect(inlinePage?.name).toBe("Inline-Page");
    expect(inlinePage?.compressed).toBe(false);
    expect(inlinePage?.getModelXml()).toContain('id="node1"');

    expect(compressedPage?.name).toBe("Compressed-Page");
    expect(compressedPage?.compressed).toBe(true);
    expect(compressedPage?.getModelXml()).toContain('id="txt1"');
  });

  it("throws a clear error on malformed XML", () => {
    expect(() => loadDrawioDocument("<mxfile><diagram>oops</mxfile>")).toThrow();
  });

  it("throws a clear error when the root element is not <mxfile>", () => {
    expect(() => loadDrawioDocument("<notmxfile></notmxfile>")).toThrow(/expected root element/i);
  });

  it("throws a clear, catchable error for a page with corrupted compressed content", () => {
    const xml = '<mxfile><diagram id="x" name="Bad">%%%not-valid%%%</diagram></mxfile>';
    const doc = loadDrawioDocument(xml);
    const [page] = getPages(doc);
    expect(() => page?.getModelXml()).toThrow(/could not be decompressed/i);
  });
});

describe("serializeDrawioDocument", () => {
  it("round-trips an uncompressed single-page document semantically", async () => {
    const xml = await readFixture("simple.drawio");
    const doc = loadDrawioDocument(xml);
    const serialized = serializeDrawioDocument(doc);

    const reloaded = loadDrawioDocument(serialized);
    const originalPages = getPages(loadDrawioDocument(xml));
    const reloadedPages = getPages(reloaded);

    expect(reloadedPages).toHaveLength(originalPages.length);
    expect(reloadedPages[0]?.getModelXml()).toBe(originalPages[0]?.getModelXml());
  });

  it("round-trips a compressed single-page document, preserving compressed storage", async () => {
    const xml = await readFixture("compressed.drawio");
    const doc = loadDrawioDocument(xml);
    const serialized = serializeDrawioDocument(doc);

    const reloaded = loadDrawioDocument(serialized);
    const [page] = getPages(reloaded);

    expect(page?.compressed).toBe(true);

    const originalModel = getPages(loadDrawioDocument(xml))[0]?.getModelXml();
    expect(page?.getModelXml()).toBe(originalModel);
  });

  it("round-trips a multi-page mixed document preserving each page's storage format", async () => {
    const xml = await readFixture("multipage.drawio");
    const doc = loadDrawioDocument(xml);
    const serialized = serializeDrawioDocument(doc);

    const reloadedPages = getPages(loadDrawioDocument(serialized));
    const originalPages = getPages(loadDrawioDocument(xml));

    expect(reloadedPages).toHaveLength(2);
    reloadedPages.forEach((page, i) => {
      expect(page.compressed).toBe(originalPages[i]?.compressed);
      expect(page.getModelXml()).toBe(originalPages[i]?.getModelXml());
    });
  });

  it("setModelXml on an inline page keeps it inline after re-serialization", async () => {
    const xml = await readFixture("simple.drawio");
    const doc = loadDrawioDocument(xml);
    const [page] = getPages(doc);
    const newModel = '<mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel>';

    page?.setModelXml(newModel);
    const serialized = serializeDrawioDocument(doc);

    expect(serialized).toContain("<mxGraphModel>");
    expect(serialized).not.toMatch(/<diagram[^>]*>[A-Za-z0-9+/=]+<\/diagram>/);

    const reloaded = getPages(loadDrawioDocument(serialized));
    expect(reloaded[0]?.compressed).toBe(false);
    expect(reloaded[0]?.getModelXml().replace(/\s+\/>/g, "/>")).toBe(newModel.replace(/\s+\/>/g, "/>"));
  });

  it("setModelXml on a compressed page keeps it compressed after re-serialization", async () => {
    const xml = await readFixture("compressed.drawio");
    const doc = loadDrawioDocument(xml);
    const [page] = getPages(doc);
    const newModel = '<mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel>';

    page?.setModelXml(newModel);
    const serialized = serializeDrawioDocument(doc);

    const reloaded = getPages(loadDrawioDocument(serialized));
    expect(reloaded[0]?.compressed).toBe(true);
    expect(reloaded[0]?.getModelXml()).toBe(newModel);
  });
});

describe("compression sanity used by document round-trips", () => {
  it("compress -> decompress reproduces the original mxGraphModel xml", () => {
    const model = '<mxGraphModel><root><mxCell id="0" /></root></mxGraphModel>';
    expect(decompressDiagramContent(compressDiagramContent(model))).toBe(model);
  });
});

/**
 * Draw.io `.drawio` document loader (PRD section 7 / Phase 2).
 *
 * A `.drawio` file is an `<mxfile>` document containing one or more
 * `<diagram>` elements. Each `<diagram>` element holds page content either
 * as inline `<mxGraphModel>` XML, or as base64 raw-deflate compressed text
 * (see compression.ts).
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmlDocument, Element as XmlElement } from "@xmldom/xmldom";
import { compressDiagramContent, decompressDiagramContent } from "./compression.js";

/** A parsed `.drawio` document, wrapping the underlying `<mxfile>` DOM. */
export interface DrawioDocument {
  readonly xmlDoc: XmlDocument;
}

/** A single `<diagram>` page within a `.drawio` document. */
export interface DrawioPage {
  /** The `id` attribute of the `<diagram>` element, if present. */
  readonly id: string | null;
  /** The `name` attribute of the `<diagram>` element, if present. */
  readonly name: string | null;
  /** Whether this page's content is stored compressed in the source document. */
  readonly compressed: boolean;
  /** Returns this page's mxGraphModel content as an XML string. */
  getModelXml(): string;
  /**
   * Replaces this page's mxGraphModel content.
   *
   * By default preserves the page's original compressed/inline storage
   * format. Pass `forceCompressed` to override that (used by Phase 6's
   * `--format compressed|uncompressed` transformer option, PRD section
   * 18) - `true` always stores compressed, `false` always stores inline.
   */
  setModelXml(xml: string, forceCompressed?: boolean): void;
}

function parseXml(xml: string): XmlDocument {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        errors.push(message);
      }
    },
  });
  const doc = parser.parseFromString(xml, "text/xml");
  if (errors.length > 0) {
    throw new Error(`Invalid draw.io XML: ${errors[0]}`);
  }
  return doc;
}

/**
 * Parses a `.drawio` file's XML content into a document model.
 *
 * Throws a clear, catchable error on malformed XML.
 */
export function loadDrawioDocument(xml: string): DrawioDocument {
  const xmlDoc = parseXml(xml);
  const root = xmlDoc.documentElement;
  if (!root || root.nodeName !== "mxfile") {
    throw new Error('Invalid draw.io document: expected root element "<mxfile>".');
  }
  return { xmlDoc };
}

function findMxGraphModelElement(diagram: XmlElement): XmlElement | null {
  for (let i = 0; i < diagram.childNodes.length; i++) {
    const node = diagram.childNodes.item(i);
    if (
      node &&
      node.nodeType === 1 &&
      (node as unknown as XmlElement).nodeName === "mxGraphModel"
    ) {
      return node as unknown as XmlElement;
    }
  }
  return null;
}

function isElementNode(node: ReturnType<XmlElement["childNodes"]["item"]>): node is XmlElement {
  return node !== null && node.nodeType === 1;
}

function hasElementChild(diagram: XmlElement): boolean {
  for (let i = 0; i < diagram.childNodes.length; i++) {
    if (isElementNode(diagram.childNodes.item(i))) {
      return true;
    }
  }
  return false;
}

function textContentOf(element: XmlElement): string {
  return element.textContent ?? "";
}

function makePage(xmlDoc: XmlDocument, diagram: XmlElement): DrawioPage {
  const id = diagram.getAttribute("id");
  const name = diagram.getAttribute("name");
  const compressed = !hasElementChild(diagram);

  return {
    id,
    name,
    compressed,
    getModelXml(): string {
      if (compressed) {
        return decompressDiagramContent(textContentOf(diagram));
      }
      const model = findMxGraphModelElement(diagram);
      if (!model) {
        throw new Error(
          `Invalid draw.io page${name ? ` "${name}"` : ""}: missing <mxGraphModel> content.`,
        );
      }
      return new XMLSerializer().serializeToString(model);
    },
    setModelXml(xml: string, forceCompressed: boolean = compressed): void {
      while (diagram.firstChild) {
        diagram.removeChild(diagram.firstChild);
      }
      if (forceCompressed) {
        diagram.appendChild(xmlDoc.createTextNode(compressDiagramContent(xml)));
        return;
      }
      const parsed = parseXml(xml);
      if (!parsed.documentElement) {
        throw new Error("Invalid mxGraphModel XML: no root element.");
      }
      const imported = xmlDoc.importNode(parsed.documentElement, true);
      diagram.appendChild(imported);
    },
  };
}

/**
 * Returns each `<diagram>` page in the document, exposing its
 * mxGraphModel content whether stored inline or compressed.
 */
export function getPages(doc: DrawioDocument): DrawioPage[] {
  const diagrams = doc.xmlDoc.getElementsByTagName("diagram");
  const pages: DrawioPage[] = [];
  for (let i = 0; i < diagrams.length; i++) {
    const diagram = diagrams.item(i);
    if (diagram) {
      pages.push(makePage(doc.xmlDoc, diagram as unknown as XmlElement));
    }
  }
  return pages;
}

/** Serializes a document model back into `.drawio` XML text. */
export function serializeDrawioDocument(doc: DrawioDocument): string {
  return new XMLSerializer().serializeToString(doc.xmlDoc);
}

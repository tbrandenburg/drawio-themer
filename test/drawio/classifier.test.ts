import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement } from "@xmldom/xmldom";
import { classifyCell } from "../../src/drawio/classifier.js";

function parseCell(xml: string): { cell: XmlElement; wrapper?: XmlElement } {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as XmlElement;
  const mxCell = root.getElementsByTagName("mxCell").item(0) as unknown as XmlElement | null;
  if (mxCell) {
    return { cell: mxCell, wrapper: root.nodeName === "mxCell" ? undefined : root };
  }
  return { cell: root };
}

describe("classifyCell", () => {
  it("classifies a plain vertex node", () => {
    const { cell } = parseCell(
      '<mxCell id="1" vertex="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;"/>',
    );
    expect(classifyCell(cell)).toEqual({ classes: ["node"], semanticTags: [] });
  });

  it("classifies an edge", () => {
    const { cell } = parseCell('<mxCell id="2" edge="1" style="edgeStyle=orthogonalEdgeStyle;"/>');
    expect(classifyCell(cell)).toEqual({ classes: ["edge"], semanticTags: [] });
  });

  it("classifies a draw.io invisible group cell as group, not node (Golden Rule: Preserve Semantics)", () => {
    const { cell } = parseCell(
      '<mxCell id="grp1" value="" style="group" vertex="1" connectable="0"/>',
    );
    expect(classifyCell(cell)).toEqual({ classes: ["group"], semanticTags: [] });
  });

  it("classifies a swimlane as a container", () => {
    const { cell } = parseCell(
      '<mxCell id="3" vertex="1" style="swimlane;whiteSpace=wrap;html=1;"/>',
    );
    const result = classifyCell(cell);
    expect(result.classes).toContain("container");
    expect(result.classes[0]).toBe("container");
  });

  it("classifies container=1 styled cells as a container", () => {
    const { cell } = parseCell('<mxCell id="3b" vertex="1" style="rounded=0;container=1;"/>');
    expect(classifyCell(cell).classes).toContain("container");
  });

  it("classifies a shape=cylinder3 cell as a database", () => {
    const { cell } = parseCell(
      '<mxCell id="4" vertex="1" style="shape=cylinder3;whiteSpace=wrap;html=1;"/>',
    );
    const result = classifyCell(cell);
    expect(result.classes).toEqual(["database"]);
  });

  it("classifies a shape=cylinder cell as a database", () => {
    const { cell } = parseCell('<mxCell id="4b" vertex="1" style="shape=cylinder;"/>');
    expect(classifyCell(cell).classes).toEqual(["database"]);
  });

  it("classifies an image cell (shape=image;image=...)", () => {
    const { cell } = parseCell(
      '<mxCell id="5" vertex="1" style="shape=image;image=data:image/png,xyz;"/>',
    );
    const result = classifyCell(cell);
    expect(result.classes[0]).toBe("image");
    expect(result.classes).toContain("image");
  });

  it("classifies a text-only cell", () => {
    const { cell } = parseCell(
      '<mxCell id="6" vertex="1" style="text;html=1;align=center;verticalAlign=middle;"/>',
    );
    const result = classifyCell(cell);
    expect(result.classes[0]).toBe("text");
  });

  it("does not misclassify a plain filled vertex as text", () => {
    const { cell } = parseCell(
      '<mxCell id="6b" vertex="1" style="rounded=0;whiteSpace=wrap;html=1;"/>',
    );
    expect(classifyCell(cell).classes).toEqual(["node"]);
  });

  it("exposes derived role/tag semantic metadata from a UserObject wrapper", () => {
    const { cell, wrapper } = parseCell(
      '<UserObject id="service-1" role="service" tags="backend critical"><mxCell id="7" vertex="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#fff;strokeColor=#000;"/></UserObject>',
    );
    const result = classifyCell(cell, wrapper);
    expect(result.semanticTags).toEqual(["role:service", "tag:backend", "tag:critical"]);
    expect(result.classes).toEqual(["node"]);
  });

  it("gives image priority over other applicable classes", () => {
    const { cell } = parseCell(
      '<mxCell id="8" vertex="1" style="shape=image;image=foo.png;container=1;"/>',
    );
    expect(classifyCell(cell).classes[0]).toBe("image");
  });
});

import { describe, expect, it } from "vitest";
import { renderDrawioToSvg, FONT_FALLBACK_STACK } from "../../src/render/svg.js";

function drawio(rootCells: string): string {
  return `<mxfile host="test"><diagram id="p1" name="Page-1"><mxGraphModel><root>${rootCells}</root></mxGraphModel></diagram></mxfile>`;
}

describe("renderDrawioToSvg", () => {
  it("renders a simple rectangular node with its label", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Start" style="fillColor=#dae8fc;strokeColor=#6c8ebf;" ' +
        'vertex="1" parent="1"><mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<rect x="10" y="20" width="100" height="50"');
    expect(svg).toContain('fill="#dae8fc"');
    expect(svg).toContain('stroke="#6c8ebf"');
    expect(svg).toContain(">Start<");
  });

  it("renders a database cylinder shape distinctly from a plain rect", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="db1" value="Orders DB" style="shape=cylinder3;fillColor=#ffe6cc;strokeColor=#d79b00;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain("<ellipse");
    expect(svg).toContain('<path d="M 0,18');
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("clips edges to the node's border instead of drawing from center to center", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="300" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="strokeColor=#000000;" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const match = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)"/);
    expect(match).not.toBeNull();
    const x1 = Number(match?.[1]);
    // Node n1 spans x=0..100 centered at 50; the clipped edge start must sit
    // on its right border (x=100), not at the center (x=50).
    expect(x1).toBe(100);
  });

  it("draws containers before their children (z-order)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="child" value="Inner" style="fillColor=#00ff00;" vertex="1" parent="1">' +
        '<mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>' +
        '<mxCell id="box" value="Container" style="container=1;fillColor=#eeeeee;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // "box" (the container) is declared after "child" in document order but
    // must be drawn first so the child renders on top.
    expect(svg.indexOf("#eeeeee")).toBeLessThan(svg.indexOf("#00ff00"));
  });

  it("appends the font fallback stack to whatever fontFamily the theme sets", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Label" style="fontFamily=Inter;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(`font-family="Inter, ${FONT_FALLBACK_STACK}"`);
  });

  it("translates a child node's parent-relative geometry into absolute page coordinates", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="panel" value="Panel" style="container=1;" vertex="1" parent="1">' +
        '<mxGeometry x="1330" y="20" width="200" height="200" as="geometry"/></mxCell>' +
        '<mxCell id="child" value="Child" style="" vertex="1" parent="panel">' +
        '<mxGeometry x="90" y="75" width="40" height="30" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // Child geometry (90,75) is relative to its parent "panel" at
    // (1330,20); the absolute page position must be (1420,95), not the
    // raw (90,75) near the page origin.
    expect(svg).toContain('<rect x="1420" y="95" width="40" height="30"');
  });

  it("nests parent-relative offsets across more than one level of container", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="outer" style="container=1;" vertex="1" parent="1">' +
        '<mxGeometry x="100" y="50" width="500" height="500" as="geometry"/></mxCell>' +
        '<mxCell id="inner" style="container=1;" vertex="1" parent="outer">' +
        '<mxGeometry x="10" y="10" width="300" height="300" as="geometry"/></mxCell>' +
        '<mxCell id="leaf" style="" vertex="1" parent="inner">' +
        '<mxGeometry x="5" y="5" width="20" height="20" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // leaf absolute = outer(100,50) + inner(10,10) + leaf(5,5) = (115,65).
    expect(svg).toContain('<rect x="115" y="65" width="20" height="20"');
  });

  it("auto-fits the canvas to the document's mxGraphModel pageWidth/pageHeight", () => {
    const xml =
      '<mxfile host="test"><diagram id="p1" name="Page-1">' +
      '<mxGraphModel pageWidth="1600" pageHeight="900"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="n1" style="" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>' +
      "</root></mxGraphModel></diagram></mxfile>";

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('width="1600" height="900" viewBox="0 0 1600 900"');
  });

  it("falls back to the content bounding box when pageWidth/pageHeight are absent", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1">' +
        '<mxGeometry x="900" y="400" width="100" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // bbox right/bottom = (1000, 450) + 20px margin = (1020, 470).
    expect(svg).toContain('width="1020" height="470" viewBox="0 0 1020 470"');
  });

  it("respects an explicit width/height override via viewBox scaling", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml, { width: 400, height: 300 });

    expect(svg).toContain('width="400" height="300" viewBox="0 0 120 120"');
  });

  it("uses only the fallback stack when no fontFamily is set", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Label" style="" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(`font-family="${FONT_FALLBACK_STACK}"`);
  });
});

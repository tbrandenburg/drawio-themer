import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  convertWebpImagesToPng,
  FONT_FALLBACK_STACK,
  renderDrawioToSvg,
} from "../../src/render/svg.js";

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

  it("draws a swimlane container before a child declared earlier in the XML, even without container=1 (issue #27)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="child" value="Inner" style="fillColor=#00ff00;" vertex="1" parent="lane">' +
        '<mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>' +
        '<mxCell id="lane" value="Lane" style="swimlane;fillColor=#fafafa;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(">Inner<");
    // "lane" is a swimlane (no explicit container=1) declared after "child"
    // in document order, but must still be drawn first so the child's
    // fill/border render on top instead of being painted over.
    expect(svg.indexOf("#fafafa")).toBeLessThan(svg.indexOf("#00ff00"));
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

  it("grows the canvas past a declared pageWidth/pageHeight when content overflows it", () => {
    const xml =
      '<mxfile host="test"><diagram id="p1" name="Page-1">' +
      '<mxGraphModel pageWidth="200" pageHeight="200"><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="n1" style="" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="400" height="400" as="geometry"/></mxCell>' +
      "</root></mxGraphModel></diagram></mxfile>";

    const svg = renderDrawioToSvg(xml);

    // bbox right/bottom = (400, 400) + 20px margin = (420, 420), which
    // exceeds the declared 200x200 page, so the canvas must grow to fit it.
    expect(svg).toContain('width="420" height="420" viewBox="0 0 420 420"');
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

  it("renders shape=image cells as an <image> element instead of a blank rect", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="icon1" value="" style="shape=image;image=data:image/png,ZmFrZQ==;html=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="10" y="20" width="32" height="32" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<image x="10" y="20" width="32" height="32"');
    // draw.io stores embedded images without the RFC 2397 ";base64,"
    // marker (it clashes with the style string's own ";" delimiter);
    // the renderer must re-insert it so the data URI actually decodes.
    expect(svg).toContain('href="data:image/png;base64,ZmFrZQ=="');
    expect(svg).not.toMatch(/<rect x="10" y="20"/);
  });

  it("passes a non-data-URI image reference (e.g. a plain URL) through unchanged", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="icon1" value="" style="shape=image;image=https://example.com/icon.png;html=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="32" height="32" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('href="https://example.com/icon.png"');
  });

  it("falls back to a plain rect when shape=image has no image data", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="icon1" value="" style="shape=image;fillColor=#eeeeee;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="32" height="32" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("<image");
    expect(svg).toContain('<rect x="0" y="0" width="32" height="32"');
  });

  it("left-aligns a container/swimlane title using align+spacingLeft instead of always centering it", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="1 Experience Layer" ' +
        'style="container=1;verticalAlign=top;align=left;spacingLeft=10;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="400" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('x="14"');
    expect(svg).not.toContain('x="200"');
  });

  it("renders an ellipse shape as an <ellipse>, not a generic rect", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Decision" style="ellipse;fillColor=#d5e8d4;strokeColor=#82b366;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<ellipse cx="40" cy="20" rx="40" ry="20"');
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders a text; cell with no <rect> box at all (issue #29)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Footer" ' +
        'style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#63738A;" ' +
        'vertex="1" parent="1"><mxGeometry x="90" y="840" width="210" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toMatch(/<rect x="90" y="840"/);
    expect(svg).toContain("Footer");
  });

  it("renders a rhombus shape as a diamond <polygon>, not a generic rect", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Check" style="rhombus;fillColor=#fff2cc;strokeColor=#d6b656;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<polygon points="40\.0,0\.0 80\.0,20\.0 40\.0,40\.0 0\.0,20\.0"/);
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=hexagon as a hexagonal <polygon>, not a generic rect", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Step" style="shape=hexagon;fillColor=#f8cecc;strokeColor=#b85450;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain("<polygon");
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("routes an edge with explicit mxPoint waypoints as a polyline through those points", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="300" y="300" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="strokeColor=#000000;" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"><Array as="points">' +
        '<mxPoint x="200" y="50"/></Array></mxGeometry></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain("<polyline");
    expect(svg).toContain("200.0,50.0");
    expect(svg).not.toMatch(/<line x1=/);
  });

  it("connects an edge with exitX/exitY/entryX/entryY at the specified fractional border point", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="300" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" ' +
        'edge="1" parent="1" source="n1" target="n2"><mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const match = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    expect(match).not.toBeNull();
    // exitX=1,exitY=0.5 on n1 (0,0,100,100) => (100,50); entryX=0,entryY=0.5
    // on n2 (300,0,100,100) => (300,50).
    expect(Number(match?.[1])).toBe(100);
    expect(Number(match?.[2])).toBe(50);
    expect(Number(match?.[3])).toBe(300);
    expect(Number(match?.[4])).toBe(50);
  });

  it("rotates a horizontal=0 swimlane title -90deg along the left edge instead of centering it horizontally", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="panel" value="Side Panel" style="container=1;horizontal=0;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="300" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/transform="rotate\(-90 /);
    expect(svg).toContain(">Side Panel<");
  });

  it("renders all pages of a multi-page document, not just the first", () => {
    const xml =
      '<mxfile host="test"><diagram id="p1" name="Page-1"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="n1" value="PageOneNode" style="" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>' +
      "</root></mxGraphModel></diagram>" +
      '<diagram id="p2" name="Page-2"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="n2" value="PageTwoNode" style="" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>' +
      "</root></mxGraphModel></diagram></mxfile>";

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(">PageOneNode<");
    expect(svg).toContain(">PageTwoNode<");
  });

  it("wraps a long label onto multiple lines when whiteSpace=wrap is set", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="This is a fairly long label that must wrap" ' +
        'style="whiteSpace=wrap;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="60" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textCount = (svg.match(/<text /g) ?? []).length;
    expect(textCount).toBeGreaterThan(1);
  });

  it("does not re-wrap an already-line-broken label that fits each line (issue #30)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Automation &amp;&#xa;Workflows" ' +
        'style="whiteSpace=wrap;fontSize=14;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="70" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textCount = (svg.match(/<text /g) ?? []).length;
    expect(textCount).toBe(2);
  });

  it("does not wrap a label when whiteSpace=wrap is absent, even if it overflows", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="This is a fairly long label" style="" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="60" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textCount = (svg.match(/<text /g) ?? []).length;
    expect(textCount).toBe(1);
  });

  it("renders a dashed node/edge with stroke-dasharray instead of a solid line", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="dashed=1;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="dashed=1;" vertex="1" parent="1">' +
        '<mxGeometry x="200" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="dashed=1;" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(
      '<rect x="0" y="0" width="50" height="50" rx="0" fill="#ffffff" fill-opacity="1" stroke="#000000" stroke-width="1" stroke-opacity="1" stroke-dasharray="4,4"',
    );
    expect(svg).toContain('stroke-dasharray="4,4"/>');
  });

  it("applies a custom dashPattern verbatim as the stroke-dasharray", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="dashed=1;dashPattern=8 4;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('stroke-dasharray="8,4"');
  });

  it("does not add stroke-dasharray for a non-dashed node", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("stroke-dasharray");
  });

  it("applies fillOpacity/strokeOpacity style properties instead of a hardcoded 1", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="fillOpacity=50;strokeOpacity=30;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).toContain('stroke-opacity="0.3"');
  });

  it("applies an overall opacity to both fill and stroke when fillOpacity/strokeOpacity are unset", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="opacity=40;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('fill-opacity="0.4"');
    expect(svg).toContain('stroke-opacity="0.4"');
  });

  it("omits the end arrow marker when endArrow=none", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="200" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="endArrow=none;" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toMatch(/marker-end/);
  });

  it("adds a start arrow marker when startArrow is set to a non-none value", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="200" y="0" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="startArrow=classic;" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('marker-start="url(#arrowStart)"');
  });

  it("does not render a cell with visible=0", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Hidden" style="" vertex="1" visible="0" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain(">Hidden<");
  });

  it("does not render children of a collapsed container", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="box" value="Box" style="container=1;collapsed=1;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="200" as="geometry"/></mxCell>' +
        '<mxCell id="child" value="Child" style="" vertex="1" parent="box">' +
        '<mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(">Box<");
    expect(svg).not.toContain(">Child<");
  });

  it("renders a plain group wrapper cell as invisible (no rect/label)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="g1" value="ShouldNotShow" style="group;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="200" as="geometry"/></mxCell>' +
        '<mxCell id="child" value="Child" style="" vertex="1" parent="g1">' +
        '<mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain(">ShouldNotShow<");
    expect(svg).toContain(">Child<");
  });

  it("applies a rotation transform to a node with a rotation style", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="rotation=45;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<g transform="rotate(45 25 25)">');
  });

  it("shifts negative-coordinate content back onto the canvas instead of clipping it (issue #15)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Offscreen" style="" vertex="1" parent="1">' +
        '<mxGeometry x="-200" y="-100" width="50" height="50" as="geometry"/></mxCell>' +
        '<mxCell id="n2" value="Onscreen" style="" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // Both nodes shift by (+200,+100) so the leftmost/topmost content
    // lands at (0,0); relative spacing between them (200,100) is preserved.
    expect(svg).toContain('<rect x="0" y="0" width="50" height="50"');
    expect(svg).toContain('<rect x="200" y="100" width="50" height="50"');
    expect(svg).not.toContain('x="-200"');
    expect(svg).not.toContain('x="-100"');
  });

  it("offsets each line of a rotated multi-line title so lines don't overlap (issue #16)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="panel" value="Line One&#10;Line Two" style="container=1;horizontal=0;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="300" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(2);
    expect(xs[0]).not.toBe(xs[1]);
  });

  it("converts html=1 labels with <br> into separate lines instead of a literal <br> tag (issue #17)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Line 1&lt;br&gt;Line 2" style="html=1;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("<br");
    expect(svg).toContain(">Line 1<");
    expect(svg).toContain(">Line 2<");
  });

  it("strips other HTML tags and decodes entities in an html=1 label (issue #17)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="&lt;b&gt;Bold&lt;/b&gt; &amp; safe" style="html=1;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(">Bold &amp; safe<");
    expect(svg).not.toContain("&lt;b&gt;");
  });

  it("positions an edge-label child cell along the edge's real path instead of at (0,0) (issue #14)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="" vertex="1" parent="1"><mxGeometry x="300" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>' +
        '<mxCell id="lbl1" value="Edge Label" style="" vertex="1" connectable="0" parent="e1">' +
        '<mxGeometry x="0" y="0" width="40" height="20" relative="1" as="geometry">' +
        '<mxPoint x="0" y="-10" as="offset"/></mxGeometry></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // The edge runs from n1's right border (x=100,y=50) to n2's left
    // border (x=300,y=50); the label's x=0 geometry is the path midpoint
    // (200,50), plus the offset's y=-10 -> label center ~ (200, 40), so
    // its box (width 40, height 20) should sit around x=180, y=30 - not
    // clipped to ~(0,0) like the pre-fix bug produced.
    expect(svg).toContain(">Edge Label<");
    const match = svg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>Edge Label</);
    expect(match).not.toBeNull();
    const textX = Number(match?.[1]);
    const textY = Number(match?.[2]);
    expect(textX).toBeGreaterThan(150);
    expect(textX).toBeLessThan(250);
    expect(textY).toBeGreaterThan(20);
    expect(textY).toBeLessThan(60);
  });
});

describe("convertWebpImagesToPng", () => {
  async function makeWebpBase64(): Promise<string> {
    const webpBuffer = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .webp()
      .toBuffer();
    return webpBuffer.toString("base64");
  }

  it("converts an embedded image/webp data URI (draw.io's no-base64-marker form) to image/png", async () => {
    const webpBase64 = await makeWebpBase64();
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        `<mxCell id="icon1" value="" style="shape=image;image=data:image/webp,${webpBase64};html=1;" ` +
        'vertex="1" parent="1"><mxGeometry x="10" y="20" width="32" height="32" as="geometry"/></mxCell>',
    );

    const converted = await convertWebpImagesToPng(xml);

    expect(converted).not.toContain("image/webp");
    // draw.io's own storage convention omits the ";base64," marker
    // (see normalizeDataUri's doc comment) - the converted value keeps
    // that convention so it still parses correctly as a `;`-delimited
    // style property.
    const match = /data:image\/png,([A-Za-z0-9+/=]+)/.exec(converted);
    expect(match).not.toBeNull();
    const pngBuffer = Buffer.from(match?.[1] ?? "", "base64");
    const metadata = await sharp(pngBuffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(2);

    const svg = renderDrawioToSvg(converted);
    expect(svg).toContain('href="data:image/png;base64,');
  });

  it("converts an embedded image/webp data URI in the RFC-compliant ;base64, form", async () => {
    const webpBase64 = await makeWebpBase64();
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        `<mxCell id="icon1" value="" style="shape=image;image=data:image/webp;base64,${webpBase64};html=1;" ` +
        'vertex="1" parent="1"><mxGeometry x="10" y="20" width="32" height="32" as="geometry"/></mxCell>',
    );

    const converted = await convertWebpImagesToPng(xml);

    expect(converted).not.toContain("image/webp");
    expect(converted).toMatch(/data:image\/png,[A-Za-z0-9+/=]+/);
  });

  it("leaves the XML unchanged when there is no embedded webp image", async () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Start" style="fillColor=#dae8fc;" vertex="1" parent="1">' +
        '<mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell>',
    );

    const converted = await convertWebpImagesToPng(xml);

    expect(converted).toBe(xml);
  });

  it("falls back to the original data URI when the payload is not decodable image data", async () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="icon1" value="" style="shape=image;image=data:image/webp,bm90LXJlYWxseS13ZWJw;html=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="32" height="32" as="geometry"/></mxCell>',
    );

    const converted = await convertWebpImagesToPng(xml);

    expect(converted).toBe(xml);
  });
});

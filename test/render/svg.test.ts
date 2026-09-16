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

    // Matches mxgraph's mxCylinder.js getCylinderSize(): min(40, round(h/5))
    // => min(40, round(100/5)) = 20.
    expect(svg).toContain("<ellipse");
    expect(svg).toContain('<path d="M 0,20');
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("caps the cylinder cap height at 40px for tall cylinders (mxgraph parity)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="db1" value="Tall DB" style="shape=cylinder3;fillColor=#ffe6cc;strokeColor=#d79b00;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="400" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // Uncapped proportional formula would give h*0.18 = 72; real mxgraph
    // caps it at 40 via min(40, round(400/5)) = min(40, 80) = 40.
    expect(svg).toContain('<path d="M 0,40');
    expect(svg).not.toContain('<path d="M 0,72');
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

  it("paints multi-level nested swimlanes before their children even when both containers are declared out of document order (issue #35 regression check for the #27 paint-order sort)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        // Document order deliberately: innermost child first, then the
        // inner lane, then the outer lane - the opposite of paint order.
        '<mxCell id="grandchild" value="Leaf" style="fillColor=#0000ff;" vertex="1" parent="inner">' +
        '<mxGeometry x="5" y="5" width="10" height="10" as="geometry"/></mxCell>' +
        '<mxCell id="inner" value="Inner" style="swimlane;fillColor=#00ff00;" vertex="1" parent="outer">' +
        '<mxGeometry x="10" y="10" width="150" height="150" as="geometry"/></mxCell>' +
        '<mxCell id="outer" value="Outer" style="swimlane;fillColor=#fafafa;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain(">Leaf<");
    // Paint order must be outer -> inner -> grandchild regardless of the
    // reversed document order above, so each nested layer renders on top
    // of its ancestor instead of being overwritten by it.
    const outerIdx = svg.indexOf("#fafafa");
    const innerIdx = svg.indexOf("#00ff00");
    const leafIdx = svg.indexOf("#0000ff");
    expect(outerIdx).toBeLessThan(innerIdx);
    expect(innerIdx).toBeLessThan(leafIdx);
    // The grandchild's absolute position must also account for both
    // ancestors' offsets (outer x=0 + inner x=10 + leaf's own x=5 = 15).
    expect(svg).toContain('x="15"');
  });

  it("computes a swimlane container's corner arc from startSize using mxSwimlane's formula (issue #39)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Lane" style="swimlane;rounded=1;startSize=40;arcSize=15;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // startSize(40) * (arcSize/100=0.15) * 3 = 18, well under min(w,h)/2=50.
    // Rendered as a rounded path (issue #50), so the arc radius shows up
    // as the Q command's control/end coordinates instead of an rx attr.
    expect(svg).toContain("Q 0,0 18,0");
  });

  it("keeps the flat arc%*min(w,h) formula for a rounded=1 rect that is not a container/swimlane (issue #39)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="rounded=1;arcSize=15;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // Flat formula: arc(15) * min(w,h)=100 / 100 = 15.
    expect(svg).toContain('rx="15"');
  });

  it("defaults a plain rounded=1 rect with no arcSize to RECTANGLE_ROUNDING_FACTOR*min(w,h) instead of 0 (issue #54)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="rounded=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="70" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // 0.15 * min(100,70)=70 = 10.5, matching real draw.io's default arc.
    expect(svg).toContain('rx="10.5"');
  });

  it("keeps square corners for a swimlane container without rounded=1 (issue #39)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Lane" style="swimlane;startSize=40;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('rx="0"');
  });

  it("splits a swimlane container into a filled title strip and an unfilled body when startSize>0 and no swimlaneFillColor is set (issue #42)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Cross-Cutting Services" ' +
        'style="swimlane;html=1;rounded=1;startSize=52;fillColor=#fafafa;strokeColor=#e4e4e7;horizontal=0;" ' +
        'vertex="1" parent="1"><mxGeometry x="20" y="20" width="300" height="880" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    // Title strip: 52-wide along the rotated-title (horizontal=0) left
    // edge, filled with the style's fillColor. rounded=1 -> rendered as a
    // path rounding only its 2 outer (left) corners (issue #50).
    expect(svg).toContain('<path d="M 72,20 L');
    expect(svg).toContain('fill="#fafafa"');
    // Body: the remaining 300-52=248-wide region, left unfilled since no
    // explicit swimlaneFillColor was set.
    expect(svg).toContain('<path d="M 72,900 L');
    expect(svg).toContain('fill="none"');
  });

  it("fills a swimlane container's body with swimlaneFillColor when explicitly set (issue #42)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Lane" ' +
        'style="swimlane;startSize=52;fillColor=#fafafa;swimlaneFillColor=#123456;horizontal=0;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<rect x="52" y="0" width="248" height="200"');
    expect(svg).toContain('fill="#123456"');
  });

  it("renders rounded swimlane title/body regions as paths with only 2 rounded outer corners each, sharp at the seam (issue #50)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Lane" ' +
        'style="swimlane;rounded=1;startSize=52;fillColor=#fafafa;horizontal=0;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const paths = [...svg.matchAll(/<path d="([^"]*Z)"/g)].map((m) => m[1]);
    expect(paths.length).toBe(2);
    for (const d of paths) {
      expect((d.match(/Q/g) ?? []).length).toBe(2);
    }
    expect(svg).not.toMatch(/<rect[^>]*rx="\d/);
  });

  it("renders rounded swimlane title/body regions as paths for horizontal=1 (title on top) with only 2 rounded outer corners each (issue #50)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="lane" value="Lane" ' +
        'style="swimlane;rounded=1;startSize=30;fillColor=#fafafa;horizontal=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const paths = [...svg.matchAll(/<path d="([^"]*Z)"/g)].map((m) => m[1]);
    expect(paths.length).toBe(2);
    for (const d of paths) {
      expect((d.match(/Q/g) ?? []).length).toBe(2);
    }
    expect(svg).not.toMatch(/<rect[^>]*rx="\d/);
  });

  it("does not split a plain (non-container) rect with startSize set, keeping a single fill (issue #42)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="startSize=40;fillColor=#eeeeee;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="100" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('<rect x="0" y="0" width="200" height="100"');
    expect(svg).not.toContain('fill="none"');
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

  it("renders shape=triangle as a triangular <polygon>, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Cond" style="shape=triangle;fillColor=#dae8fc;strokeColor=#6c8ebf;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<polygon points="0\.0,0\.0 80\.0,20\.0 0\.0,40\.0"/);
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=parallelogram as a skewed <polygon>, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Input" style="shape=parallelogram;fillColor=#d5e8d4;strokeColor=#82b366;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<polygon points="16\.0,0\.0 80\.0,0\.0 64\.0,40\.0 0\.0,40\.0"/);
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=trapezoid as a trapezoidal <polygon>, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Manual" style="shape=trapezoid;fillColor=#ffe6cc;strokeColor=#d79b00;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<polygon points="16\.0,0\.0 64\.0,0\.0 80\.0,40\.0 0\.0,40\.0"/);
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=step as a chevron/notched <polygon>, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Step" style="shape=step;fillColor=#e1d5e7;strokeColor=#9673a6;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(
      /<polygon points="0\.0,0\.0 64\.0,0\.0 80\.0,20\.0 64\.0,40\.0 0\.0,40\.0 16\.0,20\.0"/,
    );
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=cube as three beveled-face <polygon>s, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Storage" style="shape=cube;fillColor=#f5f5f5;strokeColor=#666666;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const polygonCount = (svg.match(/<polygon/g) ?? []).length;
    expect(polygonCount).toBe(3);
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
  });

  it("renders shape=actor as a stick-figure silhouette <path>, not a generic rect (issue #52)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="User" style="shape=actor;fillColor=#dae8fc;strokeColor=#6c8ebf;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="30" height="60" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<path d="M 0,60 C /);
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

  it("clips an edge endpoint to the target ellipse's real perimeter, not its bbox corner (issue #35)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        // Source directly above-and-left of the target so a naive
        // rectangular clip would land on the ellipse's bbox corner
        // (200,200) instead of a point on the actual ellipse boundary.
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="shape=ellipse;" vertex="1" parent="1"><mxGeometry x="200" y="200" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const match = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    expect(match).not.toBeNull();
    const x2 = Number(match?.[3]);
    const y2 = Number(match?.[4]);
    // The ellipse is centered at (250,250) with rx=ry=50. Along the
    // diagonal ray from n1's center (50,50) toward n2's center
    // (250,250), the true ellipse-boundary intersection is at
    // 250 - 50/sqrt(2) ≈ 214.6 for both x and y - well short of the
    // bbox corner (200,200) a rectangular clip would produce.
    const expected = 250 - 50 / Math.sqrt(2);
    expect(x2).toBeCloseTo(expected, 1);
    expect(y2).toBeCloseTo(expected, 1);
    expect(x2).not.toBe(200);
    expect(y2).not.toBe(200);
  });

  it("clips an edge endpoint to the target rhombus's real diamond perimeter, not its bbox corner (issue #35)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="rhombus;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const match = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    expect(match).not.toBeNull();
    const x2 = Number(match?.[3]);
    const y2 = Number(match?.[4]);
    // n1 and n2 centers are both at y=50, so the ray is purely
    // horizontal, hitting the rhombus's left vertex (x, y+h/2) = (200,50)
    // - the diamond's own leftmost point, distinct from a rectangular
    // bbox clip only insofar as it confirms the polygon-vertex math is
    // wired up correctly for this exact shape/geometry.
    expect(x2).toBeCloseTo(200, 1);
    expect(y2).toBeCloseTo(50, 1);
  });

  it("clips an edge endpoint to the target hexagon's real perimeter, not its bbox corner (issue #35)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        // n1's center is (80,50); n2 is a hexagon (x=100,y=100,w=100,
        // h=100, inset=25) centered at (150,150). The ray between them
        // crosses the hexagon's slanted top-left edge (from (100,150) to
        // (125,100)) at a point a naive bbox clip would not reach.
        '<mxCell id="n1" style="" vertex="1" parent="1"><mxGeometry x="30" y="0" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="n2" style="shape=hexagon;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="100" height="100" as="geometry"/></mxCell>' +
        '<mxCell id="e1" style="" edge="1" parent="1" source="n1" target="n2">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const match = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
    expect(match).not.toBeNull();
    const x2 = Number(match?.[3]);
    const y2 = Number(match?.[4]);
    // Analytic ray-vs-slanted-edge intersection (same relative geometry
    // as the doc comment above, shifted +100 in y): ~(120.83, 108.33). A
    // rectangular bbox clip on the same ray would instead stop at
    // (115, 100) - clearly different from the hexagon's real perimeter
    // point.
    expect(x2).toBeCloseTo(120.83, 1);
    expect(y2).toBeCloseTo(108.33, 1);
    expect([x2, y2]).not.toEqual([115, 100]);
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

  it("routes an edgeStyle=orthogonalEdgeStyle edge with no explicit waypoints as a perpendicular polyline, not a diagonal line (issue #48)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="A" value="Source" style="rounded=0;whiteSpace=wrap;html=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>' +
        '<mxCell id="B" value="Target" style="rounded=0;whiteSpace=wrap;html=1;" ' +
        'vertex="1" parent="1"><mxGeometry x="400" y="300" width="120" height="60" as="geometry"/></mxCell>' +
        '<mxCell id="E1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;' +
        'html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="A" target="B">' +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toMatch(/<line x1="160\.0" y1="70\.0" x2="400\.0" y2="330\.0"/);
    const match = svg.match(/<polyline points="([^"]+)"/);
    expect(match).not.toBeNull();
    const points = match![1]!
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    // Exit right of A (160,70), entry left of B (400,330): every
    // segment between consecutive points must be purely horizontal or
    // vertical (no diagonal segment).
    expect(points[0]).toEqual([160, 70]);
    expect(points[points.length - 1]).toEqual([400, 330]);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const isHorizontalOrVertical = ax === bx || ay === by;
      expect(isHorizontalOrVertical).toBe(true);
    }
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

  it("wraps a bold label whose regular-weight-estimated width sits just under the wrap threshold (issue #37)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Domains &amp;amp; Edge" ' +
        'style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#e4e4e7;' +
        "fontStyle=1;fontFamily=Helvetica;fontSize=14;strokeWidth=1;fontColor=#18181b;" +
        'arcSize=12;shadow=0;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="70" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textCount = (svg.match(/<text /g) ?? []).length;
    expect(textCount).toBeGreaterThan(1);
  });

  it("preserves a manual line break in a non-wrapped html=1 label (issue #41)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="ONE PLATFORM&#xa;GREATER POSSIBILITIES" ' +
        'style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#63738A;" ' +
        'vertex="1" parent="1">' +
        '<mxGeometry x="70" y="820" width="210" height="50" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textElements = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(textElements).toEqual(["ONE PLATFORM", "GREATER POSSIBILITIES"]);
  });

  it("wraps a hyphenated word with no spaces after a hyphen (issue #41)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Human-&lt;i&gt;On&lt;/i&gt;-The-Loop" ' +
        'style="rounded=1;whiteSpace=wrap;html=1;fontStyle=1;fontFamily=Helvetica;fontSize=14;" ' +
        'vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="70" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    const textCount = (svg.match(/<text /g) ?? []).length;
    expect(textCount).toBeGreaterThan(1);
  });

  it("scales multi-line spacing with fontSize instead of a fixed 14px constant (issue #47)", () => {
    const twoLineXml = (fontSize: number) =>
      drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          `<mxCell id="n1" value="Line one&#xa;Line two" ` +
          `style="whiteSpace=wrap;fontSize=${fontSize};" vertex="1" parent="1">` +
          '<mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>',
      );

    const ys = (svg: string): number[] =>
      [...svg.matchAll(/<text[^>]* y="([\d.-]+)"/g)].map((m) => Number(m[1]));

    const spacingAt = (fontSize: number): number => {
      const [y0, y1] = ys(renderDrawioToSvg(twoLineXml(fontSize)));
      expect(y1).toBeDefined();
      return y1 - y0;
    };

    const spacing12 = spacingAt(12);
    const spacing24 = spacingAt(24);

    // Fixed-14px behaviour would produce identical spacing regardless of
    // fontSize; the fontSize-derived line height must scale with it.
    expect(spacing12).toBeCloseTo(12 * 1.2, 5);
    expect(spacing24).toBeCloseTo(24 * 1.2, 5);
    expect(spacing24).toBeGreaterThan(spacing12);
  });

  it("centers a multi-line block around the single-line vertical center for verticalAlign=middle (issue #47)", () => {
    const singleLineXml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="One line" ' +
        'style="whiteSpace=wrap;fontSize=24;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>',
    );
    const twoLineXml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Line one&#xa;Line two" ' +
        'style="whiteSpace=wrap;fontSize=24;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>',
    );

    const singleY = Number(renderDrawioToSvg(singleLineXml).match(/<text[^>]* y="([\d.-]+)"/)?.[1]);
    const twoLineYs = [...renderDrawioToSvg(twoLineXml).matchAll(/<text[^>]* y="([\d.-]+)"/g)].map(
      (m) => Number(m[1]),
    );
    const [firstY, secondY] = twoLineYs;

    const lineHeight = 24 * 1.2;
    // The 2-line block must be centered on the single-line y, i.e. the
    // first line sits half a line-height above it and the second half a
    // line-height below - not pinned at the single-line y with the second
    // line pushed further down.
    expect(firstY).toBeCloseTo(singleY - lineHeight / 2, 5);
    expect(secondY).toBeCloseTo(singleY + lineHeight / 2, 5);
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

  it('honors a line-level <span style="font-weight: normal"> override within a bold-fontStyle html=1 label (issue #38)', () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="1 Experience Layer&lt;br&gt;&lt;span style=&quot;font-weight: normal;&quot;&gt;' +
        'Natural and flexible ways to work&lt;/span&gt;" style="html=1;fontStyle=1;" vertex="1" parent="1">' +
        '<mxGeometry x="0" y="0" width="200" height="60" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);
    const textElements = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];

    expect(textElements).toHaveLength(2);
    expect(textElements[0]?.[0]).toContain('font-weight="bold"');
    expect(textElements[0]?.[1]).toBe("1 Experience Layer");
    expect(textElements[1]?.[0]).not.toContain('font-weight="bold"');
    expect(textElements[1]?.[1]).toBe("Natural and flexible ways to work");
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

  describe("shadow rendering (issue #44)", () => {
    it("wraps a rect with the dropShadow filter when shadow=1", () => {
      const xml = drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="n1" value="Start" style="fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;" ' +
          'vertex="1" parent="1"><mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell>',
      );

      const svg = renderDrawioToSvg(xml);

      expect(svg).toContain('<filter id="dropShadow"');
      expect(svg).toMatch(
        /<g filter="url\(#dropShadow\)"><rect x="10" y="20" width="100" height="50"/,
      );
    });

    it("does not emit the dropShadow filter or wrapper when no cell sets shadow=1", () => {
      const xml = drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="n1" value="Start" style="fillColor=#dae8fc;strokeColor=#6c8ebf;" ' +
          'vertex="1" parent="1"><mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell>',
      );

      const svg = renderDrawioToSvg(xml);

      expect(svg).not.toContain("dropShadow");
      expect(svg).not.toContain("<filter");
    });

    it("wraps a cylinder shape with the dropShadow filter when shadow=1", () => {
      const xml = drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="db1" value="Orders DB" ' +
          'style="shape=cylinder3;fillColor=#ffe6cc;strokeColor=#d79b00;shadow=1;" ' +
          'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="100" as="geometry"/></mxCell>',
      );

      const svg = renderDrawioToSvg(xml);

      expect(svg).toContain('<filter id="dropShadow"');
      expect(svg).toMatch(/<g filter="url\(#dropShadow\)"><g stroke="#d79b00"/);
    });

    it("treats shadow=0 the same as no shadow property", () => {
      const xml = drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="n1" value="Start" style="fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=0;" ' +
          'vertex="1" parent="1"><mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell>',
      );

      const svg = renderDrawioToSvg(xml);

      expect(svg).not.toContain("dropShadow");
    });
  });

  describe("fontStyle bitmask (issue #32)", () => {
    function labelSvg(fontStyle: string | undefined): string {
      const styleAttr = fontStyle === undefined ? "" : `fontStyle=${fontStyle};`;
      const xml = drawio(
        '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          `<mxCell id="n1" value="Label" style="${styleAttr}" ` +
          'vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell>',
      );
      return renderDrawioToSvg(xml);
    }

    it('fontStyle="1" renders bold only', () => {
      const svg = labelSvg("1");
      expect(svg).toContain('font-weight="bold"');
      expect(svg).not.toContain('font-style="italic"');
      expect(svg).not.toContain("text-decoration=");
    });

    it('fontStyle="2" renders italic only', () => {
      const svg = labelSvg("2");
      expect(svg).not.toContain('font-weight="bold"');
      expect(svg).toContain('font-style="italic"');
      expect(svg).not.toContain("text-decoration=");
    });

    it('fontStyle="4" renders underline only', () => {
      const svg = labelSvg("4");
      expect(svg).not.toContain('font-weight="bold"');
      expect(svg).not.toContain('font-style="italic"');
      expect(svg).toContain('text-decoration="underline"');
    });

    it('fontStyle="3" renders both bold and italic', () => {
      const svg = labelSvg("3");
      expect(svg).toContain('font-weight="bold"');
      expect(svg).toContain('font-style="italic"');
      expect(svg).not.toContain("text-decoration=");
    });

    it('fontStyle="7" renders bold, italic, and underline together', () => {
      const svg = labelSvg("7");
      expect(svg).toContain('font-weight="bold"');
      expect(svg).toContain('font-style="italic"');
      expect(svg).toContain('text-decoration="underline"');
    });

    it("fontStyle absent or 0 renders none of the style attributes", () => {
      const svgAbsent = labelSvg(undefined);
      expect(svgAbsent).not.toContain('font-weight="bold"');
      expect(svgAbsent).not.toContain('font-style="italic"');
      expect(svgAbsent).not.toContain("text-decoration=");

      const svgZero = labelSvg("0");
      expect(svgZero).not.toContain('font-weight="bold"');
      expect(svgZero).not.toContain('font-style="italic"');
      expect(svgZero).not.toContain("text-decoration=");
    });
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

describe("renderDrawioToSvg gradientColor/gradientDirection", () => {
  it("renders a top-to-bottom linearGradient when gradientDirection is unset (south default)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;gradientColor=#0000ff;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<linearGradient id="grad0" x1="0" y1="0" x2="0" y2="1">/);
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff"/>');
    expect(svg).toContain('fill="url(#grad0)"');
  });

  it("renders a bottom-to-top linearGradient for gradientDirection=north", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;gradientColor=#0000ff;gradientDirection=north;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<linearGradient id="grad0" x1="0" y1="1" x2="0" y2="0">/);
  });

  it("renders a left-to-right linearGradient for gradientDirection=east", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;gradientColor=#0000ff;gradientDirection=east;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<linearGradient id="grad0" x1="0" y1="0" x2="1" y2="0">/);
  });

  it("renders a right-to-left linearGradient for gradientDirection=west", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;gradientColor=#0000ff;gradientDirection=west;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toMatch(/<linearGradient id="grad0" x1="1" y1="0" x2="0" y2="0">/);
  });

  it("triggers gradient rendering without the --glow flag", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;gradientColor=#0000ff;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml, {});

    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('fill="url(#grad0)"');
  });

  it("renders a flat solid fill (no gradient) for a cell without gradientColor", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fillColor=#ff0000;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("<linearGradient");
    expect(svg).toContain('fill="#ff0000"');
  });

  it("resolves fontColor=default to the ambient default instead of emitting the literal string (issue #54)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="fontColor=default;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("default");
    expect(svg).toContain('fill="#000000"');
  });

  it("resolves strokeColor=default to the ambient default instead of emitting the literal string (issue #54)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="strokeColor=default;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).not.toContain("default");
    expect(svg).toContain('stroke="#000000"');
  });

  it("defaults a missing fontSize to 11 (mxgraph's DEFAULT_FONTSIZE), not 12 (issue #54)", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);

    expect(svg).toContain('font-size="11"');
  });
});

describe("label positioning and clipping (issue #55)", () => {
  it("places a verticalLabelPosition=bottom label below the shape's box, not centered inside it", () => {
    const defaultXml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );
    const externalXml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="verticalLabelPosition=bottom;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const defaultY = Number(renderDrawioToSvg(defaultXml).match(/<text[^>]* y="([\d.-]+)"/)?.[1]);
    const externalY = Number(renderDrawioToSvg(externalXml).match(/<text[^>]* y="([\d.-]+)"/)?.[1]);

    // Box is y=0..40; a centered label's baseline sits inside that range,
    // an external bottom label's baseline must sit below the box (> 40).
    expect(defaultY).toBeLessThan(40);
    expect(externalY).toBeGreaterThan(40);
  });

  it("places a labelPosition=right label to the right of the shape's box", () => {
    const xml = drawio(
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
        '<mxCell id="n1" value="Box" style="labelPosition=right;" ' +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const svg = renderDrawioToSvg(xml);
    const textX = Number(svg.match(/<text[^>]* x="([\d.-]+)"/)?.[1]);

    expect(textX).toBeGreaterThan(80);
    expect(svg).toContain('text-anchor="start"');
  });

  it("truncates/clips a clipped=1 label instead of auto-wrapping it to more lines", () => {
    const longLabel = "A very long label that would normally wrap onto several lines of text";
    const wrappedXml = drawio(
      `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="n1" value="${longLabel}" style="whiteSpace=wrap;" ` +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );
    const clippedXml = drawio(
      `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="n1" value="${longLabel}" style="whiteSpace=wrap;clipped=1;" ` +
        'vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>',
    );

    const wrappedLineCount = [...renderDrawioToSvg(wrappedXml).matchAll(/<text[^>]*>/g)].length;
    const clippedSvg = renderDrawioToSvg(clippedXml);
    const clippedLineCount = [...clippedSvg.matchAll(/<text[^>]*>/g)].length;

    expect(wrappedLineCount).toBeGreaterThan(1);
    expect(clippedLineCount).toBe(1);
    expect(clippedSvg).toContain("<clipPath");
    expect(clippedSvg).toContain("clip-path=");
  });
});

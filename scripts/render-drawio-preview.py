#!/usr/bin/env python3
"""Lightweight, offline .drawio -> SVG preview renderer for chat/demo purposes.

NOT a replacement for draw.io's real renderer (no waypoints, no HTML labels,
no groups/rotation). It reads mxCell fill/stroke/font colors + basic shapes
(rect/cylinder) and draws an approximate SVG.

Two glow modes, because the two rasterizers available in this environment
support different SVG features:

- `--glow` (default): manual stacked semi-transparent strokes, no
  <filter>. Use this when rasterizing with ImageMagick's `convert`
  (no `rsvg-convert` binary here -> falls back to the MSVG delegate,
  which silently ignores <filter> primitives like feGaussianBlur and
  does not anti-alias strokes the way a browser does).
- `--filter-glow`: real SVG <filter> feGaussianBlur/feMerge + gradient
  fills. Only renders correctly through an actual browser engine
  (Chromium/Playwright screenshot), NOT through `convert`. Serve the
  SVG over local HTTP (`file://` is blocked in the Playwright MCP
  browser) and screenshot it for proper anti-aliasing/glow/gradients.

Always verify the chosen mode against the actual rasterizer you intend
to use - `--filter-glow` piped through `convert` will look identical to
no glow at all, and `--glow` through a browser will look coarser than
necessary.

Usage: python3 render-drawio-preview.py <input.drawio> <output.svg> [bg] [--glow|--filter-glow]
"""

import sys
from xml.etree import ElementTree as ET

# The generated `.drawio` file's fontFamily (e.g. "Inter") is a valid,
# bundled web font in real draw.io/diagrams.net, but this offline preview
# sandbox has no internet and no such font installed - only system fonts
# like "Noto Sans" (verified via `fc-match`). Rather than mutate the
# theme's actual fontFamily token (which must stay correct for real
# draw.io), append known-installed fallbacks here so the *preview* still
# renders a modern sans instead of Chromium's serif default for an
# unrecognized font name.
FONT_FALLBACK_STACK = "Noto Sans, Helvetica Neue, Arial, sans-serif"


def parse_style(s):
    d = {}
    if not s:
        return d
    for part in s.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            d[k] = v
    return d


def clip_to_rect(cx, cy, ox, oy, rx, ry, rw, rh):
    """Clip the point at the rect's edge along the line from (cx,cy) [this
    rect's center] toward (ox,oy) [the other endpoint], so edges terminate
    on the node's border instead of its center."""
    dx, dy = ox - cx, oy - cy
    if dx == 0 and dy == 0:
        return cx, cy
    hw, hh = rw / 2, rh / 2
    scale = min(
        abs(hw / dx) if dx else float("inf"),
        abs(hh / dy) if dy else float("inf"),
    )
    return cx + dx * scale, cy + dy * scale


def lighten(hex_color, amount=24):
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return hex_color
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    r, g, b = (min(255, c + amount) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def manual_glow_strokes(path_attrs_fn, color, base_width):
    layers = [
        (base_width + 8, 0.12),
        (base_width + 4, 0.25),
        (base_width, 1.0),
    ]
    return [path_attrs_fn(color, w, op) for w, op in layers]


def render(infile, outfile, bg="#ffffff", mode="none"):
    """mode: "none" | "glow" (manual multi-stroke) | "filter-glow" (real <filter>, browser-only)."""
    tree = ET.parse(infile)
    root = tree.getroot()
    cells = {cell.get("id"): cell for cell in root.iter("mxCell")}

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="850" height="700">'
        f'<rect width="850" height="700" fill="{bg}"/>'
    ]
    defs = [
        '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" '
        'refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#888"/></marker>'
    ]
    if mode == "filter-glow":
        defs.append(
            '<filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">'
            '<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>'
            '<feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
            "</filter>"
        )
    gradient_ids = {}

    def gradient_for(fill):
        if fill in gradient_ids:
            return gradient_ids[fill]
        gid = f"grad{len(gradient_ids)}"
        gradient_ids[fill] = gid
        defs.append(
            f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{lighten(fill, 14)}"/>'
            f'<stop offset="1" stop-color="{fill}"/>'
            "</linearGradient>"
        )
        return gid

    node_geo = {}
    for cid, cell in cells.items():
        if cell.get("vertex") == "1":
            geo = cell.find("mxGeometry")
            if geo is not None:
                node_geo[cid] = (
                    float(geo.get("x", 0)),
                    float(geo.get("y", 0)),
                    float(geo.get("width", 0)),
                    float(geo.get("height", 0)),
                )

    def center(cid):
        if cid in node_geo:
            x, y, w, h = node_geo[cid]
            return x + w / 2, y + h / 2
        return None

    edge_svg = []
    for cid, cell in cells.items():
        if cell.get("edge") != "1":
            continue
        style = parse_style(cell.get("style", ""))
        src, tgt = cell.get("source"), cell.get("target")
        c1, c2 = center(src), center(tgt)
        if not (c1 and c2):
            continue
        sx, sy, sw_, sh_ = node_geo[src]
        tx, ty, tw_, th_ = node_geo[tgt]
        p1 = clip_to_rect(c1[0], c1[1], c2[0], c2[1], sx, sy, sw_, sh_)
        p2 = clip_to_rect(c2[0], c2[1], c1[0], c1[1], tx, ty, tw_, th_)
        stroke = style.get("strokeColor", "#000000")
        sw = float(style.get("strokeWidth", "1"))

        def edge_layer(color, width, opacity, p1=p1, p2=p2):
            marker = ' marker-end="url(#arrow)"' if opacity == 1.0 else ""
            return (
                f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" '
                f'y2="{p2[1]:.1f}" stroke="{color}" stroke-width="{width}" '
                f'stroke-opacity="{opacity}"{marker}/>'
            )

        if mode == "glow":
            edge_svg.extend(manual_glow_strokes(edge_layer, stroke, sw))
        elif mode == "filter-glow":
            edge_svg.append(f'<g filter="url(#softGlow)">{edge_layer(stroke, sw, 1.0)}</g>')
        else:
            edge_svg.append(edge_layer(stroke, sw, 1.0))
    svg.extend(edge_svg)

    def sort_key(item):
        _, cell = item
        return 0 if "container=1" in cell.get("style", "") else 1

    node_svg = []
    for cid, cell in sorted(cells.items(), key=sort_key):
        if cell.get("vertex") != "1":
            continue
        geo = cell.find("mxGeometry")
        x, y, w, h = (
            float(geo.get("x", 0)),
            float(geo.get("y", 0)),
            float(geo.get("width", 0)),
            float(geo.get("height", 0)),
        )
        style = parse_style(cell.get("style", ""))
        fill = style.get("fillColor", "#ffffff")
        stroke = style.get("strokeColor", "#000000")
        fontcolor = style.get("fontColor", "#000000")
        sw = float(style.get("strokeWidth", "1"))
        try:
            arc = float(style.get("arcSize", "0"))
            rx = arc * min(w, h) / 100 if arc <= 100 else arc
        except ValueError:
            rx = 0
        shape = style.get("shape", "")
        label = cell.get("value", "")
        font_family = f'{style.get("fontFamily", "")}, {FONT_FALLBACK_STACK}'.strip(", ")
        font_size = style.get("fontSize", "12")
        valign = style.get("verticalAlign", "middle")
        bold = 'font-weight="bold"' if style.get("fontStyle") == "1" else ""
        ty = y + 18 if valign == "top" else y + h / 2 + 5
        fill_ref = f"url(#{gradient_for(fill)})" if mode == "filter-glow" else fill

        if "cylinder" in shape:
            eh = h * 0.18

            def cyl_layer(color, width, opacity, x=x, y=y, w=w, h=h, eh=eh, fill=fill_ref):
                return (
                    f'<g stroke="{color}" stroke-width="{width}" stroke-opacity="{opacity}" fill="{fill}">'
                    f'<path d="M {x},{y+eh} L {x},{y+h-eh} A {w/2},{eh} 0 0 0 {x+w},{y+h-eh} '
                    f'L {x+w},{y+eh} A {w/2},{eh} 0 0 0 {x},{y+eh} Z"/>'
                    f'<ellipse cx="{x+w/2}" cy="{y+eh}" rx="{w/2}" ry="{eh}"/>'
                    "</g>"
                )

            if mode == "glow":
                node_svg.extend(manual_glow_strokes(cyl_layer, stroke, sw))
            elif mode == "filter-glow":
                node_svg.append(f'<g filter="url(#softGlow)">{cyl_layer(stroke, sw, 1.0)}</g>')
                node_svg.append(cyl_layer(stroke, sw, 1.0))  # crisp pass on top of the blur
            else:
                node_svg.append(cyl_layer(stroke, sw, 1.0))
            ty = y + h / 2 + eh / 2
        else:

            def rect_layer(color, width, opacity, x=x, y=y, w=w, h=h, rx=rx, fill=fill_ref):
                return (
                    f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
                    f'fill="{fill}" stroke="{color}" stroke-width="{width}" stroke-opacity="{opacity}"/>'
                )

            if mode == "glow":
                node_svg.extend(manual_glow_strokes(rect_layer, stroke, sw))
            elif mode == "filter-glow":
                node_svg.append(f'<g filter="url(#softGlow)">{rect_layer(stroke, sw, 1.0)}</g>')
                node_svg.append(rect_layer(stroke, sw, 1.0))  # crisp pass on top of the blur
            else:
                node_svg.append(rect_layer(stroke, sw, 1.0))

        for i, line in enumerate(label.split("\n")):
            node_svg.append(
                f'<text x="{x+w/2}" y="{ty + i*14}" text-anchor="middle" '
                f'font-family="{font_family}" font-size="{font_size}" fill="{fontcolor}" {bold}>{line}</text>'
            )
    svg.extend(node_svg)

    svg.insert(1, "<defs>" + "".join(defs) + "</defs>")
    svg.append("</svg>")
    with open(outfile, "w") as f:
        f.write("\n".join(svg))


if __name__ == "__main__":
    mode = "none"
    if "--glow" in sys.argv:
        mode = "glow"
    if "--filter-glow" in sys.argv:
        mode = "filter-glow"
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    render(args[0], args[1], args[2] if len(args) > 2 else "#ffffff", mode=mode)

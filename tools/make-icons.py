#!/usr/bin/env python3
"""
Generate the PWA icon set for Debt Free — محرر الديون.

Draws the app mark locally with Pillow: a dark navy (#0e1420) rounded square
carrying the X Star mark, using the exact polygon geometry from the footer
SVG in index.html so the icon matches the in-app branding.

No network access, no downloaded assets.

    python tools/make-icons.py

Outputs: icon-192.png, icon-512.png, favicon.ico
"""

from pathlib import Path

from PIL import Image, ImageDraw

# Brand palette — must stay in sync with index.html
NAVY = (14, 20, 32, 255)      # #0e1420  app dark background
BLUE = (33, 118, 255, 255)    # #2176FF  X Star blue
WHITE = (255, 255, 255, 255)  # stands in for var(--text) on dark

SS = 4  # supersampling factor for antialiasing

# X Star mark, verbatim from the <svg viewBox="0 0 100 100"> footer lockup.
MARK = [
    (WHITE, [(15, 12), (33, 12), (56.4, 48), (38.4, 48)]),
    (BLUE,  [(43.6, 54), (61.6, 54), (85, 90), (67, 90)]),
    (BLUE,  [(67, 12), (85, 12), (61.6, 48), (43.6, 48)]),
    (WHITE, [(38.4, 54), (56.4, 54), (33, 90), (15, 90)]),
    (BLUE,  [(88, 0), (91.2, 7.8), (99, 11), (91.2, 14.2),
             (88, 22), (84.8, 14.2), (77, 11), (84.8, 7.8)]),
]

# Bounding box of the whole mark in viewBox units (includes the sparkle).
BBOX = (15.0, 0.0, 99.0, 90.0)

# Fraction of the canvas the mark occupies. Kept modest so the icon survives
# Android's maskable safe zone (inner 80% circle) without clipping.
MARK_SCALE = 0.56


def render(size: int) -> Image.Image:
    """Render one square icon at the given pixel size."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded navy plate.
    radius = int(s * 0.22)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=NAVY)

    # Fit the mark's bounding box into MARK_SCALE of the canvas, centered.
    bw = BBOX[2] - BBOX[0]
    bh = BBOX[3] - BBOX[1]
    scale = (s * MARK_SCALE) / max(bw, bh)
    off_x = (s - bw * scale) / 2 - BBOX[0] * scale
    off_y = (s - bh * scale) / 2 - BBOX[1] * scale

    for color, points in MARK:
        draw.polygon(
            [(x * scale + off_x, y * scale + off_y) for x, y in points],
            fill=color,
        )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parent.parent

    for size in (192, 512):
        out = root / f"icon-{size}.png"
        render(size).save(out, "PNG", optimize=True)
        print(f"wrote {out.name}  ({out.stat().st_size:,} bytes)")

    # Multi-resolution favicon built from the largest render.
    ico = root / "favicon.ico"
    render(256).save(ico, "ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print(f"wrote {ico.name}  ({ico.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

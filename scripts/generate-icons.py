#!/usr/bin/env python3
"""
Draws every Block Fall raster asset from the same description as the in-app
brand mark: three rounded blocks stepping down a diagonal, the shape the game
is named after.

Nothing here is traced, downloaded or derived from another game's artwork — it
is a handful of primitives placed by arithmetic. Outputs:

    web/assets/icons/favicon.svg          scalable tab icon
    web/assets/icons/icon-{180,192,512}   PWA + apple-touch
    web/assets/icons/maskable-{192,512}   safe-area padded for Android
    web/assets/icons/og-cover.png         1200x630 social preview

Everything is drawn at 4x and downsampled, which is cheaper than fighting
Pillow for antialiased corners.

Usage: python3 scripts/generate-icons.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "web" / "assets" / "icons"

# Pulled from shared/skins.json (the `nebula` skin) — kept in sync by eye
# because the icons are regenerated rarely and a build-time read would make
# this script depend on a JSON parse for two colours.
BG = (7, 11, 24, 255)
ACCENT = (34, 211, 238, 255)
ACCENT_ALT = (168, 85, 247, 255)
INK = (4, 32, 40, 255)

SUPERSAMPLE = 4


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(size: int, pad_ratio: float = 0.0, with_bg: bool = True) -> Image.Image:
    """Three blocks stepping down-right, drawn into a square canvas."""
    s = size * SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if with_bg:
        rounded(draw, (0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=BG)

    # Safe area for maskable icons: Android may crop to a circle.
    inner = s * (1 - pad_ratio * 2)
    origin = (s - inner) / 2

    # A 3x3 field with three blocks on the diagonal plus one companion, so the
    # silhouette reads as "blocks landing" rather than a plain checker.
    cells = [(0, 0), (1, 1), (2, 2), (2, 1)]
    step = inner / 3.35
    gap = step * 0.12
    block = step - gap
    radius = int(block * 0.26)

    for i, (row, col) in enumerate(cells):
        t = i / max(1, len(cells) - 1)
        colour = lerp(ACCENT, ACCENT_ALT, t)
        x = origin + col * step + gap / 2 + inner * 0.03
        y = origin + row * step + gap / 2 + inner * 0.03
        rounded(draw, (x, y, x + block, y + block), radius=radius, fill=colour)

    return img.resize((size, size), Image.LANCZOS)


def write_png(img: Image.Image, name: str) -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    path = ICONS / name
    img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.width}x{img.height}")


def write_favicon() -> None:
    """An SVG twin of the mark, so the tab icon stays crisp at any size."""
    cells = [(0, 0), (1, 1), (2, 2), (2, 1)]
    parts = []
    for i, (row, col) in enumerate(cells):
        t = i / max(1, len(cells) - 1)
        r, g, b, _ = lerp(ACCENT, ACCENT_ALT, t)
        x = 6 + col * 17
        y = 6 + row * 17
        parts.append(
            f'<rect x="{x}" y="{y}" width="15" height="15" rx="4" fill="rgb({r},{g},{b})"/>'
        )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<rect width="64" height="64" rx="14" fill="rgb{BG[:3]}"/>'
        + "".join(parts)
        + "</svg>"
    )
    path = ICONS / "favicon.svg"
    path.write_text(svg, encoding="utf-8")
    print(f"  {path.relative_to(ROOT)}")


def write_cover() -> None:
    """1200x630 social preview: the mark on the app's own background."""
    w, h = 1200, 630
    img = Image.new("RGBA", (w, h), BG)
    draw = ImageDraw.Draw(img)

    # Soft washes echoing the in-app backdrop.
    for cx, cy, rad, colour, alpha in [
        (0.16, 0.14, 0.55, (124, 58, 237), 0.35),
        (0.86, 0.22, 0.5, (34, 211, 238), 0.24),
        (0.72, 0.9, 0.55, (244, 114, 182), 0.2),
    ]:
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        r = rad * w
        ld.ellipse(
            (cx * w - r, cy * h - r, cx * w + r, cy * h + r),
            fill=(*colour, int(255 * alpha)),
        )
        img = Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(90)))
        draw = ImageDraw.Draw(img)

    mark = draw_mark(300, with_bg=False)
    img.paste(mark, (int(w * 0.5 - 150), int(h * 0.5 - 190)), mark)

    write_png(img.convert("RGB").convert("RGBA"), "og-cover.png")


def main() -> None:
    print("Block Fall icons:")
    write_favicon()
    for size in (180, 192, 512):
        write_png(draw_mark(size), f"icon-{size}.png")
    for size in (192, 512):
        write_png(draw_mark(size, pad_ratio=0.1), f"maskable-{size}.png")
    write_cover()


if __name__ == "__main__":
    main()

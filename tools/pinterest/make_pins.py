#!/usr/bin/env python3
"""
Bridge & Bow Travel - Pinterest pin image generator (1000x1500).

Run from the repo root:   python3 tools/pinterest/make_pins.py [slug ...]
Writes JPEGs to assets/img/pins/. Source photos are only READ; they are never
modified. Output is re-encoded, so EXIF/GPS metadata is not carried over.

Pin text and sources live in pins_data.py.

Style matches the first six pins: photo fills the frame, navy gradient at the
bottom, white serif title, brass URL line. Pages with no suitable photo get a
type-only navy pin (kind="type").

Privacy: `cover` lists small regions (in SOURCE-image pixel coordinates) that
are painted over before cropping, e.g. a sticker with a number on it.
Fonts: DejaVu Serif Bold / DejaVu Sans Bold (present on most Linux boxes).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1000, 1500
NAVY = (24, 36, 52)
CREAM = (248, 244, 236)
BRASS = (222, 189, 120)
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SRC = "assets/img/trip"
OUT = "assets/img/pins"
URL_TEXT = "BRIDGEANDBOWTRAVEL.COM"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pins_data import all_variants  # noqa: E402


def build_specs():
    """Every variant that needs an image generated (existing=True ones are skipped)."""
    specs = []
    for _page, _n, v in all_variants():
        if v.get("existing"):
            continue
        specs.append(dict(v, title=v["image_title"]))
    return specs


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def fit_title(draw, text, max_w, max_lines, start=76, floor=52):
    for size in range(start, floor - 1, -2):
        f = font(SERIF, size)
        lines = wrap(draw, text, f, max_w)
        if len(lines) <= max_lines:
            return f, lines, size
    f = font(SERIF, floor)
    return f, wrap(draw, text, f, max_w), floor


def spaced(draw, xy, text, fnt, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking


def cover_regions(img, regions):
    """Paint small circles over sensitive details using a blend of nearby pixels."""
    import cv2, numpy as np
    arr = np.array(img.convert("RGB"))
    mask = np.zeros(arr.shape[:2], np.uint8)
    for (x, y, r) in regions:
        cv2.circle(mask, (x, y), r, 255, -1)
    arr = cv2.inpaint(arr, mask, 6, cv2.INPAINT_TELEA)
    return Image.fromarray(arr)


def photo_background(p):
    img = Image.open(os.path.join(SRC, p["src"])).convert("RGB")
    if p.get("cover"):
        img = cover_regions(img, p["cover"])
    scale = max(W / img.width, H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = int((img.width - W) * p.get("focus", 0.5))
    top = 0
    return img.crop((left, top, left + W, top + H))


def type_background():
    bg = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(bg)
    for y in range(H):  # subtle vertical gradient, darker at top like the social card
        t = y / H
        c = tuple(int(a + (b - a) * t) for a, b in zip((8, 18, 32), (16, 32, 58)))
        d.line([(0, y), (W, y)], fill=c)
    # simple brass ship mark (same idea as the brand mark)
    cx, cy = W // 2, 400
    d.ellipse([cx - 140, cy - 140, cx + 140, cy + 140], fill=(8, 20, 34))
    brass = (184, 134, 48)
    d.polygon([(cx - 95, cy + 20), (cx + 80, cy + 20), (cx + 120, cy + 55), (cx + 70, cy + 95), (cx - 85, cy + 95)], fill=brass)
    d.rounded_rectangle([cx - 55, cy - 40, cx + 15, cy + 20], radius=6, fill=brass)
    d.rectangle([cx - 22, cy - 95, cx - 14, cy - 40], fill=brass)
    d.ellipse([cx - 28, cy - 105, cx - 8, cy - 85], fill=brass)
    for i in range(3):
        d.rectangle([cx - 44 + i * 22, cy - 22, cx - 32 + i * 22, cy - 10], fill=(8, 20, 34))
    return bg


def render(p):
    probe = ImageDraw.Draw(Image.new("RGB", (W, H)))
    if p["kind"] == "photo":
        f, lines, size = fit_title(probe, p["title"], W - 140, 4)
    else:
        f, lines, size = fit_title(probe, p["title"], W - 140, 6, start=92, floor=60)
    lh = int(size * 1.18)
    title_bottom = 1385
    title_top = title_bottom - lh * len(lines)

    if p["kind"] == "photo":
        img = photo_background(p).convert("RGBA")
        grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grad)
        start, full = title_top - 260, title_top + 20   # scrim keyed to where the text sits
        for y in range(max(0, start), H):
            t = min(1.0, (y - start) / float(full - start))
            gd.line([(0, y), (W, y)], fill=NAVY + (int(255 * 0.94 * t),))
        img = Image.alpha_composite(img, grad).convert("RGB")
    else:
        img = type_background()
    d = ImageDraw.Draw(img)

    y = title_bottom - lh * len(lines)
    if p["kind"] == "type":
        y = 720
        spaced(d, (70, y - 56), p["kicker"], font(SANS, 26), BRASS, 5)
    for ln in lines:
        d.text((70, y), ln, font=f, fill=CREAM)
        y += lh
    spaced(d, (70, 1425), URL_TEXT, font(SANS, 26), BRASS, 3)
    return img


def main():
    wanted = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    for p in build_specs():
        if wanted and p["slug"] not in wanted:
            continue
        img = render(p)
        assert img.size == (W, H)
        path = os.path.join(OUT, p["slug"] + ".jpg")
        img.save(path, "JPEG", quality=88, optimize=True)
        print("wrote", path)


if __name__ == "__main__":
    main()

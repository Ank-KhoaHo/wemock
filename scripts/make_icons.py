"""Draws the wemock icon (public/icon/*.png). Run: python scripts/make_icons.py public/icon

Draws: a blue rounded square with a white geometric 'w'."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
N = 512
img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, N - 16, N - 16], radius=112, fill=(12, 102, 228, 255))
# a 'w' as one polyline, with round joins
pts = [(118, 168), (190, 352), (256, 232), (322, 352), (394, 168)]
w = 58
d.line(pts, fill=(255, 255, 255, 255), width=w, joint="curve")
for x, y in (pts[0], pts[-1]):
    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(out / f"{size}.png")
print("ok")

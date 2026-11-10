"""Draws the Chrome Web Store icon: 128x128 PNG whose artwork is 96x96, centred, with 16 px of
transparent padding on each side, as the Store's image guide asks. Same drawing as
scripts/make_icons.py (a blue rounded square with a white 'w'), with a soft shadow so it reads on
both light and dark pages.

Run: python scripts/store/make_store_icon.py docs/store/images"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

S = 4  # draw at 4x, then scale down
N = 128 * S
ART = 96 * S
PAD = (N - ART) // 2

art = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(art)
d.rounded_rectangle([0, 0, 511, 511], radius=112, fill=(12, 102, 228, 255))
pts = [(118, 168), (190, 352), (256, 232), (322, 352), (394, 168)]
w = 58
d.line(pts, fill=(255, 255, 255, 255), width=w, joint="curve")
for x, y in (pts[0], pts[-1]):
    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
art = art.resize((ART, ART), Image.LANCZOS)

canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([PAD, PAD + 2 * S, PAD + ART, PAD + ART + 2 * S], radius=21 * S, fill=(0, 0, 0, 70))
canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(3 * S)))
canvas.alpha_composite(art, (PAD, PAD))
canvas.resize((128, 128), Image.LANCZOS).save(out / "store-icon-128.png")
print("ok", out / "store-icon-128.png")

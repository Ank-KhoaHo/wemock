"""The three pictures every app here has: an icon, a banner and a cover.

* the icon is a square SVG, the source of every size the extension ships
* the banner is wide (at least 960 px, about three to four times as wide as it is high), and the
  README opens with it, above its first section, with alt text
* the cover is the Chrome Web Store's small promotional tile: exactly 440 by 280

A picture's size is read from the PNG header itself, so this needs nothing beyond Python.
"""

import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ICON = ROOT / ".github" / "brand" / "icon.svg"
BANNER = ROOT / ".github" / "banner.png"
COVER = ROOT / "art" / "cover.png"
COVER_SIZE = (440, 280)


def png_size(path: Path) -> tuple[int, int]:
    """Width and height from a PNG's header. Anything that is not a PNG raises ValueError."""
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError(f"{path.name} is not a PNG")
    return struct.unpack(">II", head[16:24])


def svg_size(text: str) -> tuple[float, float]:
    """Width and height of an SVG, from its viewBox, else from its width and height."""
    box = re.search(r'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"', text)
    if box:
        return float(box.group(1)), float(box.group(2))
    width = re.search(r'\bwidth="([\d.]+)', text)
    height = re.search(r'\bheight="([\d.]+)', text)
    if not (width and height):
        raise ValueError("the SVG states no size")
    return float(width.group(1)), float(height.group(1))


def readme_opening(text: str) -> str:
    """The README above its first `##` heading: what a visitor sees before scrolling."""
    match = re.search(r"^## ", text, flags=re.M)
    return text[: match.start()] if match else text


def test_png_size_reads_the_header(tmp_path):
    sample = tmp_path / "a.png"
    sample.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + struct.pack(">II", 440, 280) + b"\x08\x06\x00\x00\x00")
    assert png_size(sample) == (440, 280)
    (tmp_path / "b.png").write_bytes(b"GIF89a" + b"\x00" * 30)
    try:
        png_size(tmp_path / "b.png")
    except ValueError:
        pass
    else:
        raise AssertionError("a file that is not a PNG was read as one")


def test_the_three_pictures_exist():
    missing = [p.relative_to(ROOT).as_posix() for p in (ICON, BANNER, COVER) if not p.is_file()]
    assert missing == [], f"missing pictures: {missing}"


def test_the_icon_is_square():
    width, height = svg_size(ICON.read_text(encoding="utf-8"))
    assert width == height, f"the icon is {width} by {height}: a store and a browser show it square"


def test_the_banner_is_wide():
    width, height = png_size(BANNER)
    assert width >= 960, f"the banner is {width} px wide; at least 960"
    assert 2.5 <= width / height <= 4.5, f"the banner is {width}x{height}: about three to four times as wide as high"


def test_the_cover_is_the_stores_small_tile():
    assert png_size(COVER) == COVER_SIZE, f"the cover is {png_size(COVER)}; the store's tile is {COVER_SIZE}"


def test_the_readme_opens_with_the_banner():
    opening = readme_opening((ROOT / "README.md").read_text(encoding="utf-8"))
    tag = re.search(r'<img\b[^>]*\bsrc="\.github/banner\.png"[^>]*>', opening)
    markdown = re.search(r"!\[([^\]]+)\]\(\.github/banner\.png\)", opening)
    assert tag or markdown, "the README does not show .github/banner.png above its first section"
    if tag:
        alt = re.search(r'\balt="([^"]+)"', tag.group(0))
        assert alt and alt.group(1).strip(), "the banner has no alt text"

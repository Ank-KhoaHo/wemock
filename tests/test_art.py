"""Every app has an icon, a banner and a cover.

Before this rule, most of the maintainer's apps lacked at least one, and each project
that fixed it wrote its own test, under three file names. The cover is also what a
shared link shows: the same file is uploaded as the repository's social preview, by
hand, because no command can. The three are due from the first released block
in CHANGELOG.md, because a picture of an app is a real render and a new project has
nothing to show. A project that keeps no CHANGELOG.md owes them now. A picture that
exists earlier is still held to its shape. Set DUE_NOW to True when the pictures
exist before the first release, and they are held from that day. A project whose
pictures live elsewhere changes the three paths below. A repository that is not an
app writes one sentence in NOT_AN_APP.

A check of this project's own (a stricter size, a second cover) goes
at the end of this file, below the last test, never in a second file,
so the rule stays in one place. If it needs a module of this project, it
imports that module inside the test, never at the top of this file: the
tests of this rule run a copy of this file in a folder that has nothing
of the project beside it, and an import at the top fails that copy.
"""

from pathlib import Path
import re
import struct

import test_docs_integrity as guard

ROOT = Path(__file__).resolve().parents[1]

# Where this project keeps its three pictures. A picture that already exists stays where it
# is, because a published page may link to it: change the path here, and in CLAUDE.md's layout.
ICON = ".github/brand/icon.svg"
BANNER = ".github/banner.png"
COVER = "art/cover.png"

# The sizes a cover may have: a store's own (itch.io, the Chrome Web Store, Google Play),
# GitHub's social preview when there is no store, or a website's link card (1200 by 630),
# because a website has no store and its cover is the card a shared link shows.
# The list is this project's own: take out the size of a store this project is not in, or
# add the size of one it is. No test of the template's holds what the list holds, so a size
# taken out fails nothing there. A test does hold that a cover of each size here passes, and
# that a cover of any other size fails.
COVER_SIZES = frozenset({(1280, 640), (630, 500), (440, 280), (1024, 500), (1200, 630)})

# A banner is at least this wide, and between these two numbers of times as wide as it is high;
# a project whose banner has another shape changes them here.
BANNER_MIN_WIDTH = 960
BANNER_MIN_RATIO = 2.5
# This project's banner, picked on 2026-11-14 and shown by the README and the store page, is
# 1280x320: four times as wide as it is high.
BANNER_MAX_RATIO = 4.0

# One sentence that says why this repository has no pictures: it is notes, or a sandbox.
# Empty for an app. With a sentence here the rule asks nothing.
NOT_AN_APP = ""

# Set it to True when the pictures exist before the first release, and they are held from that day.
DUE_NOW = False


def png_size(path: Path) -> tuple[int, int]:
    """Read width and height from the PNG header so tests need no third-party libraries."""
    data = path.read_bytes()[:24]
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError(f"{path.name} is not a PNG")
    return struct.unpack(">II", data[16:24])


def pictures_are_due(root: Path) -> bool:
    """Whether a version has left the machine: CHANGELOG.md holds a released block.

    A project with no CHANGELOG.md owes its pictures now. It cannot say it has released
    nothing, and the apps that had shipped for months were exactly the ones that kept no
    changelog: read that way, the rule would never have been due for any of them.
    """
    if DUE_NOW:
        return True
    changelog = root / "CHANGELOG.md"
    if not changelog.is_file():
        return True
    return bool(guard._released_versions(changelog.read_text(encoding="utf-8")))


def _names_whole(text: str, path: str) -> bool:
    """Check whether path stands in text as a whole path, not a substring.

    A plain `in` matches 'smart/cover.png' or
    'art/cover.png.bak', allowing planted faults to pass. We verify that path
    boundaries are not alphanumeric or path-separating characters and not
    followed by an extension.
    """
    start = 0
    while True:
        idx = text.find(path, start)
        if idx == -1:
            return False
        start = idx + 1

        if idx > 0:
            before = text[idx - 1]
            if before.isalnum() or before in "_./\\-":
                continue

        end = idx + len(path)
        if end < len(text):
            after = text[end]
            if after.isalnum() or after in "_/\\-":
                continue
            if after == "." and end + 1 < len(text):
                after_dot = text[end + 1]
                if after_dot.isalnum() or after_dot == "_":
                    continue

        return True


def _parse_dimension(val: str) -> tuple[float, str] | None:
    """Extract a numeric magnitude and optional unit from an SVG dimension string.

    SVG dimensions can be written in various equivalent notations such as '64'
    and '64.0', or with unit suffixes like '64px' or '100%'. Parsing them into
    a float and unit string allows comparing numeric values mathematically.
    """
    m = re.fullmatch(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)", val.strip())
    if not m:
        return None
    try:
        return float(m.group(1)), m.group(2)
    except ValueError:
        return None


def _dimensions_equal(w: str, h: str) -> bool:
    """Compare two SVG dimension attribute values for equality.

    An icon frame must be square, but width and height may be written in
    different formats. When both values are a number and optional unit, we
    compare the numbers as numbers and the units as text; otherwise we
    compare them as text.
    """
    pw = _parse_dimension(w)
    ph = _parse_dimension(h)
    if pw is not None and ph is not None:
        # A number with no unit is a number of pixels, as SVG reads it.
        return pw[0] == ph[0] and (pw[1] or "px") == (ph[1] or "px")
    return w.strip() == h.strip()


def art_problems(root: Path, due: bool) -> list[str]:
    """Return everything wrong with the three pictures, one sentence each."""
    problems: list[str] = []

    # 1. Missing, only when due is true.
    if due:
        for rel_path in (ICON, BANNER, COVER):
            if not (root / rel_path).is_file():
                problems.append(f"{rel_path} is missing")

    # 2. The icon, when its file exists.
    icon_file = root / ICON
    if icon_file.is_file():
        suffix = Path(ICON).suffix.lower()
        if suffix == ".svg":
            try:
                svg_text = icon_file.read_text(encoding="utf-8")
                m = re.search(r"""viewBox\s*=\s*["']([^"']*)["']""", svg_text)
                if not m:
                    problems.append(f"{ICON} has no viewBox, so its shape cannot be read")
                else:
                    tokens = [tok for tok in re.split(r"[\s,]+", m.group(1).strip()) if tok]
                    if len(tokens) != 4:
                        problems.append(f"{ICON} has no viewBox, so its shape cannot be read")
                    else:
                        try:
                            nums = [float(t) for t in tokens]
                        except ValueError:
                            problems.append(f"{ICON} has no viewBox, so its shape cannot be read")
                        else:
                            if nums[2] != nums[3]:
                                problems.append(
                                    f"{ICON} is {tokens[2]} by {tokens[3]}: an icon is square"
                                )
                svg_tag_match = re.search(r"<svg\b[\s\S]*?>", svg_text, re.IGNORECASE)
                if svg_tag_match:
                    tag_text = svg_tag_match.group(0)
                    m_w = re.search(r"""(?<![a-zA-Z0-9_-])width\s*=\s*(["'])(.*?)\1""", tag_text)
                    m_h = re.search(r"""(?<![a-zA-Z0-9_-])height\s*=\s*(["'])(.*?)\1""", tag_text)
                    if m_w and m_h:
                        w_val = m_w.group(2)
                        h_val = m_h.group(2)
                        if not _dimensions_equal(w_val, h_val):
                            problems.append(
                                f"{ICON} has width {w_val} and height {h_val}: an icon is square"
                            )
            except Exception:
                problems.append(f"{ICON} has no viewBox, so its shape cannot be read")
        elif suffix == ".png":
            try:
                w, h = png_size(icon_file)
                if w != h:
                    problems.append(f"{ICON} is {w} by {h}: an icon is square")
            except ValueError:
                problems.append(f"{ICON} is not a PNG")
        else:
            problems.append(f"{ICON} is neither an .svg nor a .png")

    # 3. The banner, when its file exists.
    banner_file = root / BANNER
    if banner_file.is_file():
        try:
            bw, bh = png_size(banner_file)
            if bw < BANNER_MIN_WIDTH:
                problems.append(f"{BANNER} is {bw}x{bh}: a banner is at least {BANNER_MIN_WIDTH} wide")
            elif bh == 0 or (bw / bh < BANNER_MIN_RATIO) or (bw / bh > BANNER_MAX_RATIO):
                problems.append(
                    f"{BANNER} is {bw}x{bh}: a banner is {BANNER_MIN_RATIO} to {BANNER_MAX_RATIO} times as wide as it is high"
                )
        except ValueError:
            problems.append(f"{BANNER} is not a PNG")

    # 4. The cover, when its file exists.
    cover_file = root / COVER
    if cover_file.is_file():
        try:
            cw, ch = png_size(cover_file)
            if (cw, ch) not in COVER_SIZES:
                sizes = ", ".join(f"{w}x{h}" for w, h in sorted(COVER_SIZES))
                problems.append(
                    f"{COVER} is {cw}x{ch}: a cover is the size its store asks for, one of {sizes}"
                )
        except ValueError:
            problems.append(f"{COVER} is not a PNG")

    # 5. The README, when the banner's file exists and root / "README.md" is a file.
    readme_file = root / "README.md"
    if banner_file.is_file() and readme_file.is_file():
        readme_text = readme_file.read_text(encoding="utf-8")
        first_line = ""
        for line in readme_text.splitlines():
            s = line.strip()
            if s:
                first_line = s
                break
        if (BANNER in first_line) and (first_line.startswith("![") or ("<img" in first_line)):
            if first_line.startswith("!["):
                idx = first_line.find("]")
                alt = first_line[2:idx] if idx != -1 else ""
            else:
                m_alt = re.search(r"""alt\s*=\s*["']([^"']*)["']""", first_line)
                alt = m_alt.group(1) if m_alt else ""
            if not alt.strip():
                problems.append("the banner has no alt text in README.md")
        else:
            problems.append(f"README.md does not open with {BANNER}")

    # 6. CLAUDE.md, when root / "CLAUDE.md" is a file.
    guidance_file = root / "CLAUDE.md"
    if guidance_file.is_file():
        guidance_text = guidance_file.read_text(encoding="utf-8")
        for p in (ICON, BANNER, COVER):
            if not _names_whole(guidance_text, p):
                problems.append(f"CLAUDE.md does not name {p}")

    return problems


def test_the_app_has_its_three_pictures() -> None:
    """Assert that every app has an icon, a banner and a cover from its first release."""
    if NOT_AN_APP:
        return
    if not (ROOT / "CLAUDE.md").is_file():
        # Working material is in no clone. Said, not skipped in silence: a check that did not
        # look must not read as one that found nothing.
        print("[CI] no CLAUDE.md on this disk: its layout was not checked for the three picture paths")
    problems = art_problems(ROOT, pictures_are_due(ROOT))
    assert problems == [], (
        f"{'; '.join(problems)}. Every app has an icon, a banner and a cover from "
        "its first release; a repository that is not an app says why in NOT_AN_APP "
        "at the top of this file."
    )


# ---------------------------------------------------------------- this project's own checks


def test_a_banner_four_times_as_wide_as_high_passes_and_no_wider(tmp_path) -> None:
    """The bound this project raised: its banner is 1280x320. A flatter one is still refused."""
    (tmp_path / ".github").mkdir()
    header = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
    for size, ok in (((1280, 320), True), ((1280, 300), False)):
        (tmp_path / BANNER).write_bytes(header + struct.pack(">II", *size) + b"\x08\x06\x00\x00\x00")
        problems = art_problems(tmp_path, due=False)
        assert (problems == []) is ok, (size, problems)


def test_the_cover_is_the_chrome_web_stores_small_tile() -> None:
    """The store takes one size for its small promotional tile; the rule allows five sizes."""
    assert png_size(ROOT / COVER) == (440, 280), f"{COVER} is not 440x280, the store's small tile"

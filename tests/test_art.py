"""Every app has an icon, a banner and a cover.

Before this rule, most of the maintainer's apps lacked at least one, and each project
that fixed it wrote its own test, under three file names. The cover is also what a
shared link shows: the same file is uploaded as the repository's social preview, by
hand, because no command can. The three are due from the first released block
in CHANGELOG.md, because a picture of an app is a real render and a new project has
nothing to show. A project that keeps no CHANGELOG.md owes them now. A picture that
exists earlier is still held to its shape. A project whose pictures live elsewhere
changes the three paths below. A repository that is not an app writes one sentence in
NOT_AN_APP.
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

# This project's banner, picked on 2026-11-14 and shown by the README and the store page, is
# 1280x320: four times as wide as it is high. The rule allows up to 4 here, not 3.5.
BANNER_MAX_RATIO = 4.0

# The sizes a cover may have: a store's own (itch.io, the Chrome Web Store, Google Play), or
# GitHub's social preview when there is no store.
COVER_SIZES = frozenset({(1280, 640), (630, 500), (440, 280), (1024, 500)})

# One sentence that says why this repository has no pictures: it is notes, or a sandbox.
# Empty for an app. With a sentence here the rule asks nothing.
NOT_AN_APP = ""


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
    changelog = root / "CHANGELOG.md"
    if not changelog.is_file():
        return True
    return bool(guard._released_versions(changelog.read_text(encoding="utf-8")))


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
            if bw < 960:
                problems.append(f"{BANNER} is {bw}x{bh}: a banner is at least 960 wide")
            elif bh == 0 or (bw / bh < 2.5) or (bw / bh > BANNER_MAX_RATIO):
                problems.append(
                    f"{BANNER} is {bw}x{bh}: a banner is about three times as wide as it is high"
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
    claude_file = root / "CLAUDE.md"
    if claude_file.is_file():
        claude_text = claude_file.read_text(encoding="utf-8")
        for p in (ICON, BANNER, COVER):
            if p not in claude_text:
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


def test_the_cover_is_the_chrome_web_stores_small_tile() -> None:
    """The store takes one size for its small promotional tile; the rule allows four sizes."""
    assert png_size(ROOT / COVER) == (440, 280), f"{COVER} is not 440x280, the store's small tile"


def test_a_banner_four_times_as_wide_as_high_passes_and_no_wider(tmp_path) -> None:
    """The bound this project raised: its banner is 1280x320. A flatter one is still refused."""
    (tmp_path / ".github").mkdir()
    header = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
    for size, ok in (((1280, 320), True), ((1280, 300), False)):
        (tmp_path / BANNER).write_bytes(header + struct.pack(">II", *size) + b"\x08\x06\x00\x00\x00")
        problems = art_problems(tmp_path, due=False)
        assert (problems == []) is ok, (size, problems)

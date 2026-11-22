"""Tests of the picture rule in tests/test_art.py: the icon, the banner and the cover.

Every app has all three. Before this rule, most of the maintainer's apps lacked at least one,
each kept its pictures in a folder of its own, and each project that fixed it wrote its own
test for the same rule, under three file names. The rule lives in one place now.

These tests drive the rule with small folders made here. None of them reads this repository's
own pictures: a project is free to have none yet, and a test that leaned on the real files
would then fail for a reason that has nothing to do with what it checks.
"""

import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import pytest

import test_art as art

# What a new project starts with, at the top of tests/test_art.py.
_SETTINGS = {
    "ICON": "art/icon.svg",
    "BANNER": "art/banner.png",
    "COVER": "art/cover.png",
    "COVER_SIZES": frozenset({(1280, 640), (630, 500), (440, 280), (1024, 500), (1200, 630)}),
    "NOT_AN_APP": "",
    "DUE_NOW": False,
    "BANNER_MIN_WIDTH": 960,
    "BANNER_MIN_RATIO": 2.5,
    "BANNER_MAX_RATIO": 3.5,
}


@pytest.fixture(autouse=True)
def _the_settings_these_examples_were_written_for(monkeypatch):
    """A project is told to change those settings: a picture that exists stays where it is.
    Every example below is written for the values above, so each test sets them itself. Read
    from the module instead, most of the tests here failed in a project that had moved one
    picture."""
    for name, value in _SETTINGS.items():
        monkeypatch.setattr(art, name, value)


def _png(path: Path, width: int, height: int) -> None:
    """The first bytes of a PNG of this size: all that a size check reads."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
                     + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00")


def _text(path: Path, *lines: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _svg(path: Path, width: float = 256, height: float = 256) -> None:
    _text(path, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">', "<circle r='4'/>", "</svg>")


_README = ("![A widget on the forge, glowing, with the install line beside it](art/banner.png)", "", "# Widget Forge", "",
           "[![build](https://example.com/badge.svg)](https://example.com/ci)", "", "*One widget at a time.*", "",
           "## What it is", "", "A tool.")
_GUIDANCE = ("# guidance", "", "## Layout", "", "```", "art/icon.svg       the app's mark",
           "art/banner.png     the README's first picture", "art/cover.png      what a store page shows", "```")


def _app(folder: Path, readme: tuple[str, ...] = _README, guidance: tuple[str, ...] | None = _GUIDANCE) -> Path:
    """A project with a sound icon, banner and cover, a README that opens with the banner, and
    a CLAUDE.md that names the three."""
    _svg(folder / "art" / "icon.svg")
    _png(folder / "art" / "banner.png", 960, 320)
    _png(folder / "art" / "cover.png", 1280, 640)
    _text(folder / "README.md", *readme)
    if guidance is not None:
        _text(folder / "CLAUDE.md", *guidance)
    return folder


# ---------------------------------------------------------------- when the pictures are due


def test_a_project_with_no_release_owes_no_picture(tmp_path):
    """A repository with no code yet has nothing real to show, and a picture of an app is a
    real render. The three are due when the first version leaves the machine."""
    _text(tmp_path / "CLAUDE.md", *_GUIDANCE)
    assert art.art_problems(tmp_path, due=False) == []


def test_once_a_version_has_left_the_machine_all_three_are_due(tmp_path):
    _text(tmp_path / "CLAUDE.md", *_GUIDANCE)
    assert art.art_problems(tmp_path, due=True) == [
        "art/icon.svg is missing", "art/banner.png is missing", "art/cover.png is missing"]


def test_a_sound_set_has_no_problem(tmp_path):
    assert art.art_problems(_app(tmp_path), due=True) == []
    assert art.art_problems(_app(tmp_path / "early"), due=False) == []


def test_the_pictures_are_due_from_the_first_released_block_of_the_changelog(tmp_path):
    assert art.pictures_are_due(tmp_path) is True, (
        "a project with no changelog cannot say it has released nothing: the apps that had "
        "shipped for months were the ones that kept none")
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## Unreleased", "", "- Project created.")
    assert art.pictures_are_due(tmp_path) is False
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "The shape:", "", "```", "## 0.1.0 — 2026-01-31", "```",
          "", "## Unreleased", "", "- Project created.")
    assert art.pictures_are_due(tmp_path) is False, "a version shown as an example was taken for a release"
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## Unreleased", "", "## 0.1.0 — 2026-01-31", "", "- First build.")
    assert art.pictures_are_due(tmp_path) is True


def test_a_release_heading_in_brackets_makes_the_pictures_due(tmp_path):
    """Keep a Changelog writes `## [0.1.0] - date`. Read as no release, the rule never fell due."""
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## [Unreleased]", "", "- Project created.")
    assert art.pictures_are_due(tmp_path) is False
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## [Unreleased]", "", "## [0.1.0] - 2026-01-31", "", "- First build.")
    assert art.pictures_are_due(tmp_path) is True


def test_a_project_can_owe_its_pictures_before_its_first_release(tmp_path, monkeypatch):
    """A project may publish all three pictures before any release, and nothing held them:
    a cover could vanish unseen until the day of the first version. DUE_NOW holds them now."""
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## Unreleased", "", "- Project created.")
    assert art.pictures_are_due(tmp_path) is False
    monkeypatch.setattr(art, "DUE_NOW", True)
    assert art.pictures_are_due(tmp_path) is True

    monkeypatch.setattr(art, "ROOT", _app(tmp_path))
    art.test_the_app_has_its_three_pictures()
    (tmp_path / "art" / "cover.png").unlink()
    with pytest.raises(AssertionError, match="art/cover.png is missing"):
        art.test_the_app_has_its_three_pictures()


def test_a_picture_made_early_is_still_held_to_its_shape(tmp_path):
    """Not due is not unchecked: an icon drawn before the first release must still be square."""
    _text(tmp_path / "CLAUDE.md", *_GUIDANCE)
    _svg(tmp_path / "art" / "icon.svg", 256, 128)
    problems = art.art_problems(tmp_path, due=False)
    assert len(problems) == 1 and "art/icon.svg" in problems[0] and "square" in problems[0], problems


# ---------------------------------------------------------------- the icon


def test_an_icon_that_is_not_square_is_reported(tmp_path):
    _svg(_app(tmp_path) / "art" / "icon.svg", 256, 128)
    problems = art.art_problems(tmp_path, due=True)
    assert problems == ["art/icon.svg is 256 by 128: an icon is square"], problems


def test_an_svg_icon_is_measured_by_its_view_box(tmp_path):
    _app(tmp_path)
    _text(tmp_path / "art" / "icon.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">', "</svg>")
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "viewBox" in problems[0], problems
    # A view box that does not start at 0 0 is still one, and a size with a decimal point is a size.
    _text(tmp_path / "art" / "icon.svg", '<svg viewBox="-8 -8 51.2 51.2">', "</svg>")
    assert art.art_problems(tmp_path, due=True) == []
    _text(tmp_path / "art" / "icon.svg", "<svg viewBox='0,0,64,64'>", "</svg>")
    assert art.art_problems(tmp_path, due=True) == [], "a view box written with commas or single quotes was not read"


def test_an_icon_may_be_a_png(tmp_path, monkeypatch):
    """A piece that already exists stays where it is: a published page may link to it. A
    project names its own paths at the top of tests/test_art.py."""
    _app(tmp_path, guidance=None)
    monkeypatch.setattr(art, "ICON", "assets/icon/icon.png")
    _png(tmp_path / "assets" / "icon" / "icon.png", 512, 512)
    assert art.art_problems(tmp_path, due=True) == []
    _png(tmp_path / "assets" / "icon" / "icon.png", 512, 256)
    assert art.art_problems(tmp_path, due=True) == ["assets/icon/icon.png is 512 by 256: an icon is square"]
    monkeypatch.setattr(art, "ICON", "assets/icon/icon.ico")
    (tmp_path / "assets" / "icon" / "icon.ico").write_bytes(b"\x00\x00\x01\x00")
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "assets/icon/icon.ico" in problems[0] and ".svg" in problems[0], problems


def test_an_icon_whose_written_width_and_height_differ_is_reported(tmp_path):
    """A square view box drawn into a frame that is not square is not a square icon."""
    icon = _app(tmp_path) / "art" / "icon.svg"
    _text(icon, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="32">', "</svg>")
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "art/icon.svg" in problems[0] and "square" in problems[0], problems
    assert "64" in problems[0] and "32" in problems[0], f"the sentence does not say what it found: {problems[0]}"

    _text(icon, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64mm" height="64px">', "</svg>")
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "64mm" in problems[0] and "64px" in problems[0], (
        f"the same number in two units was read as the same length: {problems}")


@pytest.mark.parametrize("lines", [
    ('<svg viewBox="0 0 64 64" width="64" height="64">',),
    ('<svg viewBox="0 0 64 64" width="64px" height="64px">',),
    ('<svg viewBox="0 0 64 64" width="64" height="64px">',),            # no unit is a pixel, as SVG reads it
    ("<svg viewBox='0 0 64 64' height='64.0' width='64'>",),            # the same number, written two ways
    ('<svg viewBox="0 0 64 64" width="64">',),                          # one of the two: nothing to compare
    ('<svg viewBox="0 0 64 64" stroke-width="3" width="64" height="64">',),
    ('<svg viewBox="0 0 64 64">', '<rect width="40" height="10"/>'),    # a shape inside is not the icon's frame
])
def test_icons_with_these_frames_pass(tmp_path, lines):
    _text(_app(tmp_path) / "art" / "icon.svg", *lines, "</svg>")
    assert art.art_problems(tmp_path, due=True) == []


# ---------------------------------------------------------------- the banner and the cover


@pytest.mark.parametrize("width, height, words", [
    (900, 300, ("960",)),               # too narrow for a README, which shows it at up to 960
    (960, 640, ("2.5", "3.5")),         # too high
    (2400, 400, ("2.5", "3.5")),        # too flat
    (960, 0, ("2.5", "3.5")),           # a header that says no height at all must not stop the rule
])
def test_a_banner_is_wide_and_about_three_times_as_wide_as_high(tmp_path, width, height, words):
    _png(_app(tmp_path) / "art" / "banner.png", width, height)
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "art/banner.png" in problems[0], problems
    assert all(word in problems[0] for word in words), f"the sentence does not name the bound: {problems[0]}"
    assert f"{width}x{height}" in problems[0], "the sentence does not say what size it found"


def test_a_project_sets_its_own_bounds_for_its_banner(tmp_path, monkeypatch):
    """A banner may be 4 to 1, and its project then had to edit numbers in the middle of the
    rule. The three bounds have names at the top of the file now."""
    _png(_app(tmp_path) / "art" / "banner.png", 1600, 400)
    assert len(art.art_problems(tmp_path, due=True)) == 1
    monkeypatch.setattr(art, "BANNER_MAX_RATIO", 4.2)
    assert art.art_problems(tmp_path, due=True) == []

    monkeypatch.setattr(art, "BANNER_MIN_RATIO", 4.1)
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "4.1" in problems[0] and "4.2" in problems[0], problems

    monkeypatch.setattr(art, "BANNER_MIN_RATIO", 2.5)
    monkeypatch.setattr(art, "BANNER_MIN_WIDTH", 2000)
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "2000" in problems[0], problems


@pytest.mark.parametrize("width, height", [(960, 300), (960, 384), (1200, 343), (2880, 960)])
def test_banners_of_these_sizes_pass(tmp_path, width, height):
    _png(_app(tmp_path) / "art" / "banner.png", width, height)
    assert art.art_problems(tmp_path, due=True) == []


def test_a_cover_has_the_size_its_store_asks_for(tmp_path, monkeypatch):
    """A website has no store: its cover is the card a shared link shows, 1200 by 630."""
    assert (1200, 630) in art.COVER_SIZES and len(art.COVER_SIZES) == 5
    _app(tmp_path)
    for size in sorted(art.COVER_SIZES):
        _png(tmp_path / "art" / "cover.png", *size)
        assert art.art_problems(tmp_path, due=True) == [], size
    _png(tmp_path / "art" / "cover.png", 800, 600)
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "art/cover.png is 800x600" in problems[0] and "1280x640" in problems[0], problems
    assert "1200x630" in problems[0], problems

    _png(tmp_path / "art" / "cover.png", 1280, 640)
    monkeypatch.setattr(art, "COVER_SIZES", frozenset({(600, 600)}))
    problems = art.art_problems(tmp_path, due=True)
    assert len(problems) == 1 and "600x600" in problems[0], "the sizes are not read from COVER_SIZES"


def test_a_file_that_is_not_a_png_is_said_in_words(tmp_path):
    _app(tmp_path)
    _text(tmp_path / "art" / "banner.png", "not a picture")
    _text(tmp_path / "art" / "cover.png", "not a picture either, though it is long enough to hold a header")
    problems = art.art_problems(tmp_path, due=True)
    assert problems[:2] == ["art/banner.png is not a PNG", "art/cover.png is not a PNG"], problems
    with pytest.raises(ValueError):
        art.png_size(tmp_path / "art" / "cover.png")


def test_a_png_is_measured_from_its_own_header(tmp_path):
    _png(tmp_path / "a.png", 1280, 640)
    assert art.png_size(tmp_path / "a.png") == (1280, 640)


# ---------------------------------------------------------------- where the pictures are shown and named


def test_the_readme_opens_with_the_banner(tmp_path):
    _app(tmp_path, readme=("# Widget Forge", "", "![A widget on the forge](art/banner.png)", "", "## What it is", "", "A game."))
    assert art.art_problems(tmp_path, due=True) == ["README.md does not open with art/banner.png"]
    _app(tmp_path / "icon-first", readme=("![icon](art/icon.svg)", "", "![The forge](art/banner.png)", "", "# Name"))
    assert art.art_problems(tmp_path / "icon-first", due=True) == ["README.md does not open with art/banner.png"]


def test_the_banner_says_in_words_what_it_shows(tmp_path):
    _app(tmp_path, readme=("![](art/banner.png)", "", "# Widget Forge"))
    assert art.art_problems(tmp_path, due=True) == ["the banner has no alt text in README.md"]
    _app(tmp_path / "blank", readme=("![  ](art/banner.png)", "", "# Widget Forge"))
    assert art.art_problems(tmp_path / "blank", due=True) == ["the banner has no alt text in README.md"]


def test_a_banner_written_as_html_passes_and_needs_its_alt_text_too(tmp_path):
    _app(tmp_path, readme=('<p align="center"><img src="art/banner.png" alt="A widget on the forge" width="960"></p>', "", "# Name"))
    assert art.art_problems(tmp_path, due=True) == []
    _app(tmp_path / "no-alt", readme=('<p align="center"><img src="art/banner.png" width="960"></p>', "", "# Name"))
    assert art.art_problems(tmp_path / "no-alt", due=True) == ["the banner has no alt text in README.md"]


def test_blank_lines_above_the_banner_do_not_count(tmp_path):
    _app(tmp_path, readme=("", "", "![A widget on the forge](art/banner.png)", "", "# Widget Forge"))
    assert art.art_problems(tmp_path, due=True) == []


def test_with_no_banner_yet_the_readme_is_not_asked_for_one(tmp_path):
    _app(tmp_path, readme=("# Widget Forge", "", "## What it is", "", "A game."))
    (tmp_path / "art" / "banner.png").unlink()
    assert art.art_problems(tmp_path, due=False) == []


def test_the_guidance_file_names_the_three_paths(tmp_path):
    """The layout in CLAUDE.md is where a session looks for a file. A picture nobody can find
    is drawn again, in another folder."""
    _app(tmp_path, guidance=("# guidance", "", "art/icon.svg", "art/cover.png"))
    assert art.art_problems(tmp_path, due=True) == ["CLAUDE.md does not name art/banner.png"]
    _app(tmp_path / "early", guidance=("# guidance",))
    for name in ("icon.svg", "banner.png", "cover.png"):
        (tmp_path / "early" / "art" / name).unlink()
    assert art.art_problems(tmp_path / "early", due=False) == [
        "CLAUDE.md does not name art/icon.svg", "CLAUDE.md does not name art/banner.png",
        "CLAUDE.md does not name art/cover.png"], "the paths are named from the first day, before a picture exists"
    _app(tmp_path / "none", guidance=None)
    assert art.art_problems(tmp_path / "none", due=True) == [], "a project may have no CLAUDE.md"


@pytest.mark.parametrize("line", [
    "art/cover.pngx           a typing mistake",
    "art/cover.png.bak        an old copy",
    "old/art/cover.png        a picture in another folder",
    "smart/cover.png          another folder again",
])
def test_a_path_is_named_whole(tmp_path, line):
    """`art/cover.pngx` holds the letters of `art/cover.png`. Read as naming it, a planted
    fault passed."""
    _app(tmp_path, guidance=("# guidance", "", "art/icon.svg", "art/banner.png", line))
    assert art.art_problems(tmp_path, due=True) == ["CLAUDE.md does not name art/cover.png"]


@pytest.mark.parametrize("line", [
    "art/cover.png            what a store page shows",
    "The cover is `art/cover.png`.",
    "The three: art/icon.svg, art/banner.png, art/cover.png.",
    "See (art/cover.png) and [the cover](art/cover.png).",
    "art/icon.svg · art/banner.png · art/cover.png   the three pictures",
])
def test_a_path_is_named_in_any_ordinary_sentence(tmp_path, line):
    _app(tmp_path, guidance=("# guidance", "", "art/icon.svg", "art/banner.png", line))
    assert art.art_problems(tmp_path, due=True) == []


def test_every_problem_is_reported_in_one_run(tmp_path):
    _app(tmp_path, readme=("# Name", "", "![The forge](art/banner.png)"), guidance=("# guidance", "art/icon.svg", "art/banner.png"))
    _svg(tmp_path / "art" / "icon.svg", 100, 50)
    _png(tmp_path / "art" / "banner.png", 800, 300)
    (tmp_path / "art" / "cover.png").unlink()
    assert art.art_problems(tmp_path, due=True) == [
        "art/cover.png is missing",
        "art/icon.svg is 100 by 50: an icon is square",
        "art/banner.png is 800x300: a banner is at least 960 wide",
        "README.md does not open with art/banner.png",
        "CLAUDE.md does not name art/cover.png",
    ]


# ---------------------------------------------------------------- the test a project runs


def test_the_real_test_reads_this_repository(tmp_path, monkeypatch):
    monkeypatch.setattr(art, "ROOT", _app(tmp_path))
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## 0.1.0 — 2026-01-31", "", "- First build.")
    art.test_the_app_has_its_three_pictures()
    (tmp_path / "art" / "cover.png").unlink()
    with pytest.raises(AssertionError, match="art/cover.png is missing"):
        art.test_the_app_has_its_three_pictures()


def test_a_clone_is_told_that_its_guidance_file_was_not_read(tmp_path, monkeypatch, capsys):
    """CLAUDE.md is working material: it is on the maintainer's disk, and in no clone. A check
    that did not look must say so, or it reads as a check that found nothing wrong."""
    monkeypatch.setattr(art, "ROOT", _app(tmp_path, guidance=None))
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## 0.1.0 — 2026-01-31", "", "- First build.")
    art.test_the_app_has_its_three_pictures()
    said = capsys.readouterr().out
    assert "[CI]" in said and "CLAUDE.md" in said, f"nothing said that CLAUDE.md was not read: {said!r}"

    _text(tmp_path / "CLAUDE.md", *_GUIDANCE)
    art.test_the_app_has_its_three_pictures()
    assert "[CI]" not in capsys.readouterr().out, "it said CLAUDE.md was not read, on a disk that has it"


def test_a_repository_that_is_not_an_app_says_why_and_owes_nothing(tmp_path, monkeypatch):
    """A folder of notes and a sandbox are not apps. Such a repository writes one sentence in
    NOT_AN_APP, and the rule then asks nothing of it."""
    monkeypatch.setattr(art, "ROOT", tmp_path)
    _text(tmp_path / "CHANGELOG.md", "# Changelog", "", "## 0.1.0 — 2026-01-31", "", "- First build.")
    _text(tmp_path / "CLAUDE.md", "# guidance")
    with pytest.raises(AssertionError):
        art.test_the_app_has_its_three_pictures()
    monkeypatch.setattr(art, "NOT_AN_APP", "Research notes: there is no app here.")
    art.test_the_app_has_its_three_pictures()


def test_a_new_project_starts_as_an_app_with_the_three_usual_paths():
    """Read from the file, not from the module: a project changes these, and a test above
    changes them for its own run."""
    source = Path(art.__file__).read_text(encoding="utf-8")
    for line in ('ICON = "', 'BANNER = "', 'COVER = "', 'NOT_AN_APP = "', "DUE_NOW = ", "COVER_SIZES = ",
                 "BANNER_MIN_WIDTH = ", "BANNER_MIN_RATIO = ", "BANNER_MAX_RATIO = "):
        assert sum(1 for found in source.splitlines() if found.startswith(line)) == 1, f"expected one line starting {line!r}"


def test_the_rule_says_where_a_projects_own_check_goes():
    """Projects added checks of their own, each in a place of its own choosing."""
    assert "at the end of this file" in art.__doc__, (
        "tests/test_art.py does not say that a project's stricter check goes at the end of this file")


def test_these_examples_pass_in_a_project_that_changed_its_settings(tmp_path):
    """Run for real, not argued: a copy of the rule with every setting changed (three other
    paths, one other cover size, other bounds for the banner, a sentence in NOT_AN_APP and
    DUE_NOW on), with this file beside it. Every example must still pass."""
    here = Path(__file__).parent
    for name in ("test_art.py", "test_art_rule.py", "test_docs_integrity.py"):
        shutil.copyfile(here / name, tmp_path / name)
    rule = tmp_path / "test_art.py"
    text = rule.read_text(encoding="utf-8")
    assert set(_SETTINGS) == {"ICON", "BANNER", "COVER", "COVER_SIZES", "NOT_AN_APP", "DUE_NOW",
                              "BANNER_MIN_WIDTH", "BANNER_MIN_RATIO", "BANNER_MAX_RATIO"}, (
        "a setting was added to the fixture, or left it: change it in the copy below too")
    for setting, value in (("ICON", '"assets/mark.png"'), ("BANNER", '"docs/img/top.png"'),
                           ("COVER", '"store/card.png"'), ("DUE_NOW", "True"),
                           ("COVER_SIZES", "frozenset({(999, 333)})"), ("BANNER_MIN_WIDTH", "100"),
                           ("BANNER_MIN_RATIO", "1.0"), ("BANNER_MAX_RATIO", "9.0"),
                           ("NOT_AN_APP", '"Research notes: there is no app here."')):
        text, count = re.subn(rf"(?m)^{setting} = .*$", f"{setting} = {value}", text)
        assert count == 1, f"tests/test_art.py has {count} lines that set {setting}"
    rule.write_text(text, encoding="utf-8", newline="\n")

    # Without this test itself: it would copy the copy, and that copy would copy itself.
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_art_rule.py",
         "-k", "not changed_its_settings"],
        cwd=tmp_path, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    last = (run.stdout.strip().splitlines() or ["(no output)"])[-1]
    assert run.returncode == 0 and " passed" in last and "failed" not in last and "error" not in last, (
        f"in a project that changed its settings: {last}\n{run.stdout[-3000:]}")

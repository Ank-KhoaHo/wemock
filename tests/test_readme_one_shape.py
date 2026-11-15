"""The README has one shape, and its test holds it.

A rule that said which sections a README must have fixed no names and no order, so every
project kept its own outline. A reader who has seen one of these READMEs should know where to look in the next.

The shape, from top to bottom:

    a picture, when the project has a banner        the first thing in the file
    # Name
    a facts line                                    `code chips`, or badges in a public project
    *one line in italics*
    ## What it is
    ## Get started
    ## How to use it                                optional
    ## ...the project's own sections...             any number, and only here
    ## Status
    ## Limits
    ## Alternatives
    ## FAQ
    ## Documentation
    ## Licence

The same function serves a private project, where the last four are not required. This
repository's own README is checked as a public one.

These tests say what `readme_shape_problems` answers, and that the README's own test uses it. They do not say how it is written.
"""
from pathlib import Path

import pytest

import test_readme_shape as guard

def _doc(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _scratch_root(monkeypatch, folder: Path, files: dict[str, str]) -> None:
    """Point the README's tests at a folder that holds exactly these files."""
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8", newline="\n")
    monkeypatch.setattr(guard, "ROOT", folder)


TOP = ["# Widget Forge", "", "`widget-forge` · `private`", "", "*It forges widgets.*", ""]


def _readme(*sections: str, top: list[str] | None = None) -> str:
    """A README with these sections in this order, each with one line under it."""
    lines = list(TOP if top is None else top)
    for name in sections:
        lines += [f"## {name}", "", f"Something about {name.lower()}.", ""]
    return _doc(*lines)


PRIVATE = ("What it is", "Get started", "Status", "Documentation")
PUBLIC = ("What it is", "Get started", "Status", "Limits", "Alternatives", "FAQ", "Documentation", "Licence")


def _problems(text: str, **kwargs) -> str:
    """Every problem as one string, so a test can look for the words that matter."""
    found = guard.readme_shape_problems(text, **kwargs)
    assert isinstance(found, list) and all(isinstance(item, str) for item in found)
    return "\n".join(found)


# ---------------------------------------------------------------- what fits

def test_the_smallest_private_readme_fits():
    assert guard.readme_shape_problems(_readme(*PRIVATE)) == []


def test_the_optional_sections_fit_where_they_belong():
    text = _readme("What it is", "Get started", "How to use it", "Numbers", "Proof", "Status", "Limits",
                   "Documentation")
    assert guard.readme_shape_problems(text) == []


def test_a_private_readme_may_carry_the_public_sections():
    assert guard.readme_shape_problems(_readme(*PUBLIC)) == []


def test_a_public_readme_fits_with_all_of_its_sections():
    assert guard.readme_shape_problems(_readme(*PUBLIC), public=True) == []


def test_a_heading_inside_a_code_block_is_not_a_section():
    text = _readme(*PRIVATE) + _doc("```", "## Not a section", "```")
    assert guard.readme_shape_problems(text) == []


def test_a_note_above_the_title_fits_when_there_is_no_banner():
    """A new project's README opens with a note for whoever has just copied it."""
    note = ["<!-- a note for whoever has just copied this -->", "> **Just copied this?** Read `START-HERE.md`.", ""]
    assert guard.readme_shape_problems(_readme(*PRIVATE, top=note + TOP)) == []


def test_a_note_above_the_banner_is_named():
    """With a banner, nothing comes before it: that is what makes every README open alike."""
    note = ["> **Just copied this?** Read `START-HERE.md`.", ""]
    banner = ["![Widget Forge at work](art/banner.png)", ""]
    assert "banner" in _problems(_readme(*PRIVATE, top=note + banner + TOP), banner=True)


# ---------------------------------------------------------------- the sections

@pytest.mark.parametrize("missing", PRIVATE)
def test_a_missing_section_is_named(missing):
    text = _readme(*[name for name in PRIVATE if name != missing])
    assert f"'{missing}'" in _problems(text)


@pytest.mark.parametrize("missing", ["Limits", "Alternatives", "FAQ", "Licence"])
def test_a_public_readme_needs_four_more(missing):
    text = _readme(*[name for name in PUBLIC if name != missing])
    assert f"'{missing}'" in _problems(text, public=True)
    assert guard.readme_shape_problems(text) == [], "a private README does not need it"


def test_a_section_out_of_order_is_named():
    found = _problems(_readme("What it is", "Status", "Get started", "Documentation"))
    assert "out of order" in found


def test_documentation_before_status_is_out_of_order():
    found = _problems(_readme("What it is", "Get started", "Documentation", "Status"))
    assert "'Status'" in found and "out of order" in found


def test_a_section_of_the_projects_own_after_status_is_named():
    found = _problems(_readme("What it is", "Get started", "Status", "Where things live", "Documentation"))
    assert "'Where things live'" in found and "before 'Status'" in found


def test_how_to_use_it_after_the_projects_own_sections_is_named():
    found = _problems(_readme("What it is", "Get started", "Numbers", "How to use it", "Status", "Documentation"))
    assert "'How to use it'" in found


def test_the_first_section_is_what_it_is():
    found = _problems(_readme("Install", "What it is", "Get started", "Status", "Documentation"))
    assert "first section" in found and "'What it is'" in found


def test_an_old_name_is_not_the_section():
    """`How to run it` and `Where things live` were this template's names until R42."""
    found = _problems(_readme("What it is", "How to run it", "Status", "Where things live"))
    assert "'Get started'" in found and "'Documentation'" in found


def test_a_section_with_nothing_under_it_is_named():
    text = _doc(*TOP, "## What it is", "", "It forges.", "", "## Get started", "", "## Status", "", "Not started.", "",
                "## Documentation", "", "The docs.")
    found = _problems(text)
    assert "'Get started'" in found and "nothing under it" in found


# ---------------------------------------------------------------- the top

def test_a_readme_without_its_one_line_is_named():
    top = ["# Widget Forge", "", "`widget-forge` · `private`", ""]
    assert "italics" in _problems(_readme(*PRIVATE, top=top))


def test_bold_is_not_the_one_line():
    top = ["# Widget Forge", "", "`widget-forge` · `private`", "", "**It forges widgets.**", ""]
    assert "italics" in _problems(_readme(*PRIVATE, top=top))


def test_a_readme_without_a_facts_line_is_named():
    top = ["# Widget Forge", "", "*It forges widgets.*", ""]
    assert "facts line" in _problems(_readme(*PRIVATE, top=top))


def test_badges_are_a_facts_line():
    top = ["# Widget Forge", "", "[![build](https://example.com/badge.svg)](https://example.com/ci)", "",
           "*It forges widgets.*", ""]
    assert guard.readme_shape_problems(_readme(*PUBLIC, top=top), public=True) == []


def test_a_readme_with_no_title_or_two_is_named():
    assert "'# Name'" in _problems(_readme(*PRIVATE, top=TOP[2:]))
    assert "'# Name'" in _problems(_readme(*PRIVATE, top=["# One", ""] + TOP))


@pytest.mark.parametrize("picture", [
    "![Widget Forge at work](art/banner.png)",
    '<img src="art/banner.png" alt="Widget Forge at work">',
    '<p align="center"><img src="art/banner.png" alt="Widget Forge at work"></p>',
])
def test_a_banner_is_the_first_thing(picture):
    assert guard.readme_shape_problems(_readme(*PRIVATE, top=[picture, ""] + TOP), banner=True) == []


def test_a_banner_under_the_title_is_named():
    top = ["# Widget Forge", "", "![Widget Forge at work](art/banner.png)", ""] + TOP[2:]
    assert "banner" in _problems(_readme(*PRIVATE, top=top), banner=True)


def test_a_project_with_a_banner_must_show_it():
    assert "banner" in _problems(_readme(*PRIVATE), banner=True)
    assert guard.readme_shape_problems(_readme(*PRIVATE)) == [], "with no banner, nothing is asked"


# ---------------------------------------------------------------- the guard uses it

def test_the_guard_fails_a_readme_that_leaves_the_shape(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {"README.md": _readme(*[name for name in PUBLIC if name != "Get started"])})
    with pytest.raises(AssertionError, match="Get started"):
        guard.test_the_readme_has_the_one_shape()


def test_a_private_readme_is_not_enough_here(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {"README.md": _readme(*PRIVATE)})
    with pytest.raises(AssertionError, match="Alternatives"):
        guard.test_the_readme_has_the_one_shape()


def test_the_guard_passes_a_readme_that_fits(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {"README.md": _readme(*PUBLIC)})
    guard.test_the_readme_has_the_one_shape()


def test_the_guard_asks_for_the_banner_when_the_project_has_one(monkeypatch, tmp_path):
    """`art/banner.png` is where this template puts a banner."""
    (tmp_path / "art").mkdir()
    (tmp_path / "art" / "banner.png").write_bytes(b"not a real picture; the guard only asks whether it is there")
    _scratch_root(monkeypatch, tmp_path, {"README.md": _readme(*PUBLIC)})
    with pytest.raises(AssertionError, match="banner"):
        guard.test_the_readme_has_the_one_shape()
    _scratch_root(monkeypatch, tmp_path, {"README.md": _readme(*PUBLIC, top=["![Widget Forge](art/banner.png)", ""] + TOP)})
    guard.test_the_readme_has_the_one_shape()


def test_what_it_is_must_say_something(monkeypatch, tmp_path):
    """The shape names the first section; this holds that the section is not a stub."""
    thin = _doc(*TOP, "## What it is", "", "A tool.", "", "## Get started", "", "Run it.")
    _scratch_root(monkeypatch, tmp_path, {"README.md": thin})
    with pytest.raises(AssertionError, match="What it is"):
        guard.test_the_first_section_says_what_this_is()
    full = thin.replace("A tool.", "Widget Forge makes one widget, for people who need one.")
    _scratch_root(monkeypatch, tmp_path, {"README.md": full})
    guard.test_the_first_section_says_what_this_is()


def test_this_repositorys_own_readme_has_the_shape():
    """The README a new project starts from, blanks and all."""
    text = (Path(guard.__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
    assert guard.readme_shape_problems(text, public=True) == []

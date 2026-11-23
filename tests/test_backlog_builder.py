"""The backlog builder's own tests: which ticket IDs it accepts, and the order it lists them in.

Both rules were once broken here. The builder refused ticket 100, and it listed rows in
file-name order, so ticket 10 came before ticket 2. Nothing in the docs guard could see either:
the guard checks that the page matches the builder, and the page did match it.
"""

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_backlog_html as builder  # noqa: E402

_SPEC = ("# {tid}\n\n**Status:** {status}\n\n**Section:** {letter} — Test section\n\n"
         "## Detail\n\n**Summary of {tid}**\n\nBody.\n")


def _t(letter: str, number: int, suffix: str = "") -> str:
    """A sample ticket ID, put together here so that none stands whole in this file.

    This file reaches every project, and a project's leak check refuses code that names one
    of its own tickets. The first ticket of a section is a real ticket in every backlog, so a
    sample that the builder must accept is composed: it accepts no number above 999, so a
    number that no backlog holds is not open to it. Other test files use 9001 and up.
    """
    return f"{letter}{number}{suffix}"


def _write_spec(folder: Path, tid: str, name: str | None = None, status: str = "OPEN") -> None:
    text = _SPEC.format(tid=tid, status=status, letter=tid[0])
    (folder / (name or f"{tid}-x.md")).write_text(text, encoding="utf-8", newline="\n")


def _collected_ids(folder: Path, monkeypatch) -> list[str]:
    monkeypatch.setattr(builder, "SPECS", folder)
    return [ticket[0] for ticket in builder._collect_tickets()]


def test_a_ticket_number_may_have_up_to_three_digits():
    accepted = [_t("A", 1), _t("A", 12), _t("A", 100), _t("D", 999), _t("A", 3, "-a"), _t("B", 100, "-b2")]
    refused = [tid for tid in accepted if not builder._TICKET_ID_RE.match(tid)]
    assert refused == [], f"the builder refuses valid ticket IDs: {refused}"


def test_an_id_outside_the_convention_is_still_refused():
    # `q` and `try` are the search box's DOM id and a keyword in the page's script: an ID
    # like that would break the guard that keeps ticket data out of <script>.
    invalid = ["A1000", "A", f"{_a_letter_with_no_section()}1", "a1", "q", "try", _t("A", 1, "-"), "1A", "A01x"]
    accepted = [tid for tid in invalid if builder._TICKET_ID_RE.match(tid)]
    assert accepted == [], f"the builder accepts IDs outside the convention: {accepted}"


def test_ticket_100_builds(tmp_path, monkeypatch):
    for tid in (_t("A", 99), _t("A", 100)):
        _write_spec(tmp_path, tid)
    assert _collected_ids(tmp_path, monkeypatch) == [_t("A", 99), _t("A", 100)]


def test_rows_are_ordered_by_letter_then_number_then_suffix(tmp_path, monkeypatch):
    for tid in (_t("B", 1), _t("A", 10), _t("A", 2), _t("A", 100), _t("A", 9), _t("A", 3, "-b"),
                _t("A", 3), _t("A", 3, "-a"), _t("D", 2), _t("B", 10), _t("B", 9)):
        _write_spec(tmp_path, tid)
    # A dated design document is not a ticket and must stay out of the list.
    (tmp_path / "2026-01-01-a-design.md").write_text("# A design\n", encoding="utf-8", newline="\n")
    assert _collected_ids(tmp_path, monkeypatch) == [
        _t("A", 2), _t("A", 3), _t("A", 3, "-a"), _t("A", 3, "-b"), _t("A", 9), _t("A", 10), _t("A", 100),
        _t("B", 1), _t("B", 9), _t("B", 10), _t("D", 2),
    ]


def test_the_order_comes_from_the_heading_not_the_file_name(tmp_path, monkeypatch):
    # The builder reads a ticket's ID from its `# <ID>` heading, never from the file name.
    # The order must follow the same source, or a file named differently sorts by its name.
    _write_spec(tmp_path, _t("A", 10), name="a-comes-first-by-name.md")
    _write_spec(tmp_path, _t("A", 2), name="b-comes-second-by-name.md")
    assert _collected_ids(tmp_path, monkeypatch) == [_t("A", 2), _t("A", 10)]


def test_the_page_lists_rows_in_that_order_inside_each_group(tmp_path, monkeypatch):
    for tid in (_t("A", 10), _t("A", 2), _t("A", 100)):
        _write_spec(tmp_path, tid, status="OPEN")
    for tid in (_t("D", 11), _t("D", 9), _t("D", 100)):
        _write_spec(tmp_path, tid, status="DONE")
    monkeypatch.setattr(builder, "SPECS", tmp_path)
    page = builder.render()
    assert re.findall(r'<tr data-id="([^"]+)"', page) == [
        _t("A", 2), _t("A", 10), _t("A", 100), _t("D", 9), _t("D", 11), _t("D", 100)]


def test_two_specs_with_one_id_are_still_refused(tmp_path, monkeypatch):
    _write_spec(tmp_path, _t("A", 7), name="first-copy.md")
    _write_spec(tmp_path, _t("A", 7), name="second-copy.md")
    monkeypatch.setattr(builder, "SPECS", tmp_path)
    with pytest.raises(SystemExit, match="duplicate"):
        builder._collect_tickets()


# ---------------------------------------------------------------- the six statuses


def test_built_is_a_status_between_accepted_and_done(tmp_path, monkeypatch):
    """BUILT: the work is written and every check passes, and it waits for a person or a
    device to judge it. Without the word, such a ticket sat in ACCEPTED, where it looked
    untouched, or in DONE, where it looked judged."""
    for number, status in enumerate(["DONE", "BUILT", "OPEN", "DROPPED", "ACCEPTED", "SUSPENDED"], 1):
        _write_spec(tmp_path, _t("A", number), status=status)
    monkeypatch.setattr(builder, "SPECS", tmp_path)
    page = builder.render()
    assert re.findall(r'<details class="group" id="g-([a-z]+)"', page) == [
        "open", "accepted", "built", "done", "suspended", "dropped"]
    assert '<span class="chip chip-built">BUILT</span>' in page
    assert '<details class="group" id="g-built" open>' in page, (
        "the BUILT group must start open: it is the list of what waits for the maintainer"
    )


def test_a_status_outside_the_six_is_still_refused(tmp_path, monkeypatch):
    for number, wrong in enumerate(("Built", "built", "IN PROGRESS", "BUILD")):
        folder = tmp_path / f"case-{number}"     # not named after the status: two differ only in case
        folder.mkdir()
        _write_spec(folder, _t("A", 1), status=wrong)
        monkeypatch.setattr(builder, "SPECS", folder)
        with pytest.raises(SystemExit, match="status"):
            builder._collect_tickets()


def test_the_page_can_draw_and_explain_every_status():
    template = (ROOT / "scripts" / "backlog_template.html").read_text(encoding="utf-8")
    undrawn = [status for status in builder.GROUP_ORDER if f".chip-{status.lower()}{{" not in template]
    assert undrawn == [], f"the page has no colour for {undrawn}: the chip would be invisible"
    footer = template.split("<footer>", 1)[1].split("</footer>", 1)[0]
    assert "BUILT" in footer, "the page's footer does not say what BUILT means"


def test_the_conventions_explain_every_status():
    """CLAUDE.md is working material: in the seed before a project is started, on the
    maintainer's disk afterwards, and in no clone. Whichever copy is here explains every
    status; where there is none, this says that it did not look."""
    copies = [path for path in (ROOT / "CLAUDE.md", ROOT / "template" / "seed" / "CLAUDE.md") if path.exists()]
    if not copies:
        print("[CI] no CLAUDE.md on this disk — its status table was not checked")
        return
    for path in copies:
        text = path.read_text(encoding="utf-8")
        unexplained = [status for status in builder.GROUP_ORDER if f"| **{status}** |" not in text]
        assert unexplained == [], (
            f"{path.relative_to(ROOT).as_posix()}: the status table has no row for {unexplained}"
        )


_CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _letters_with_a_section() -> list[str]:
    """The letters the builder accepts in a ticket's `**Section:**` line."""
    return [letter for letter in _CAPITALS if builder._SECTION_FMT_RE.match(f"{letter} — Name")]


def _a_letter_with_no_section() -> str:
    """Read from the builder's sections, never written here. This file used to hold `E1` as
    its example of an ID outside the convention, and failed in a project that added a
    section `E`."""
    spare = [letter for letter in _CAPITALS if letter not in _letters_with_a_section()]
    assert spare, "every capital is a section, so no example of an ID outside them is left"
    return spare[0]


def test_a_ticket_id_starts_with_a_letter_that_has_a_section_and_no_other():
    """The builder names its letters in two places: the ID and the section line. A project that
    adds a section changes both, or tickets of the new section are refused by one of them."""
    sections = _letters_with_a_section()
    assert sections, "the builder accepts no section letter at all"
    in_an_id = [letter for letter in _CAPITALS if builder._TICKET_ID_RE.match(f"{letter}1")]
    assert in_an_id == sections, (
        f"a ticket ID may start with {in_an_id}, and a section line with {sections}: the two must agree")

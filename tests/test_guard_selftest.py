"""Tests of the docs guard itself, and of the helper that sets its floors.

A guard nobody tests can go blind and still report green. Each test here states one thing the
guard must keep doing, and fails when that thing stops:

* a link inside a fenced block is checked, unless the fence is code or is marked as an illustration
* the walk sees a file that is not committed yet, and skips a gitignored one
* `scripts/set_floors.py` counts exactly what the guard counts, and rewrites only the numbers

Like the guard, these run in both states of this repository: with the working half on disk
(LOCAL) and without it (CI). A floor that only one state can measure is checked only there.
"""

import re
import sys
from pathlib import Path

import pytest

import test_docs_integrity as guard

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

FLOOR_NAMES = ("MIN_MD_FILES", "MIN_LINKS_LOCAL", "MIN_LINKS_CI", "MIN_ROWS")
# The words each floor's own assertion uses. A failure that carries none of them is a
# failure about content (a broken link, a placeholder), not about the floor.
FLOOR_WORDS = ("walk is broken", "may be vacuous", "may have lost rows")


def _is_a_floor_failure(exc: AssertionError) -> bool:
    return any(words in str(exc) for words in FLOOR_WORDS)


def _helper():
    import set_floors
    return set_floors


# ---------------------------------------------------------------- links inside fences


def _targets(text: str) -> list[str]:
    return [target for _, target in guard._iter_markdown_links(text)]


def test_a_link_in_an_untagged_fence_is_checked():
    text = "[a](before.md)\n```\n[b](inside.md)\n```\n[c](after.md)\n"
    assert _targets(text) == ["before.md", "inside.md", "after.md"]


def test_a_link_in_a_markdown_fence_is_checked():
    for tag in ("md", "markdown", "MD", "Markdown"):
        text = f"```{tag}\n[b](inside.md)\n```\n"
        assert _targets(text) == ["inside.md"], f"a ```{tag} fence was not scanned"


def test_a_fence_tagged_with_another_language_is_code():
    # `a[i](x)` is ordinary code in most languages; it is not a link.
    for tag in ("python", "bash", "gdscript", "text", "html"):
        text = f"```{tag}\nvalue = table[key](argument)\n[b](inside.md)\n```\n[c](after.md)\n"
        assert _targets(text) == ["after.md"], f"a ```{tag} fence was scanned for links"


def test_the_illustrative_marker_skips_exactly_one_fence():
    text = ("<!-- illustrative -->\n```\n[a](does-not-exist.md)\n```\n"
            "```\n[b](checked.md)\n```\n")
    assert _targets(text) == ["checked.md"]


def test_the_marker_must_sit_directly_above_the_fence():
    text = "<!-- illustrative -->\n\n```\n[a](still-checked.md)\n```\n"
    assert _targets(text) == ["still-checked.md"]


def test_tilde_fences_follow_the_same_rules():
    text = ("~~~\n[a](inside.md)\n~~~\n"
            "~~~python\n[b](code.md)\n~~~\n"
            "<!-- illustrative -->\n~~~\n[c](picture.md)\n~~~\n")
    assert _targets(text) == ["inside.md"]


def test_line_numbers_are_the_files_own():
    text = "intro\n```\n[b](inside.md)\n```\n\n[c](after.md)\n"
    assert list(guard._iter_markdown_links(text)) == [(3, "inside.md"), (6, "after.md")]


def test_a_stale_link_inside_a_fence_fails_the_guard():
    probe = ROOT / "zz-selftest-fenced-link.md"
    try:
        probe.write_text("# probe\n\n```\n[gone](zz-no-such-file.md)\n```\n",
                         encoding="utf-8", newline="\n")
        with pytest.raises(AssertionError, match="zz-selftest-fenced-link.md"):
            guard.test_every_markdown_link_resolves()
    finally:
        probe.unlink(missing_ok=True)


# ---------------------------------------------------------------- what the walk sees


def test_the_walk_sees_untracked_files_but_not_ignored_ones():
    """The floors cannot notice `--others` or `--exclude-standard` being dropped: the real
    counts sit well above them. This can."""
    fresh = ROOT / "zz-selftest-untracked.md"
    ignored_dir = ROOT / ".pytest_cache"
    hidden = ignored_dir / "zz-selftest-ignored.md"
    try:
        fresh.write_text("# probe\n", encoding="utf-8", newline="\n")
        ignored_dir.mkdir(exist_ok=True)
        hidden.write_text("# probe\n", encoding="utf-8", newline="\n")
        seen = guard._scannable("*.md")
        assert "zz-selftest-untracked.md" in seen, "a file not yet committed is invisible to the guard"
        assert not any(path.endswith("zz-selftest-ignored.md") for path in seen), (
            "a gitignored file is being scanned"
        )
    finally:
        fresh.unlink(missing_ok=True)
        hidden.unlink(missing_ok=True)


# ---------------------------------------------------------------- the floors helper


def test_a_floor_is_three_quarters_of_the_count_and_never_zero():
    helper = _helper()
    assert [helper.floor_for(n) for n in (0, 1, 2, 4, 21, 100)] == [1, 1, 1, 3, 15, 75]


def test_the_helper_measures_what_this_state_can_see():
    counts = _helper().measure()
    if guard._local_mode():
        assert sorted(counts) == sorted(FLOOR_NAMES)
        assert counts["MIN_LINKS_CI"] <= counts["MIN_LINKS_LOCAL"], (
            "a clone cannot resolve more links than the maintainer's own disk"
        )
    else:
        assert sorted(counts) == ["MIN_LINKS_CI", "MIN_MD_FILES"], (
            "without the working half on disk, only two floors can be measured"
        )


def test_the_helper_counts_exactly_what_the_guard_counts(monkeypatch):
    """One above the helper's count must trip the floor; the count itself must not."""
    counts = _helper().measure()
    local = guard._local_mode()
    checks = {
        "MIN_MD_FILES": guard.test_every_markdown_link_resolves,
        ("MIN_LINKS_LOCAL" if local else "MIN_LINKS_CI"): guard.test_every_markdown_link_resolves,
    }
    if local:
        checks["MIN_ROWS"] = guard.test_every_backlog_row_links_to_a_spec_that_exists
    for name, check in checks.items():
        assert counts[name] > 0, f"the helper counted nothing for {name}"

        monkeypatch.setattr(guard, name, counts[name] + 1)
        with pytest.raises(AssertionError) as caught:
            check()
        assert _is_a_floor_failure(caught.value), (
            f"{name}: a floor one above the helper's count did not trip, so the helper "
            f"counts more than the guard does"
        )

        monkeypatch.setattr(guard, name, counts[name])
        try:
            check()
        except AssertionError as exc:
            assert not _is_a_floor_failure(exc), (
                f"{name}: a floor equal to the helper's count tripped, so the helper "
                f"counts fewer than the guard does"
            )
        monkeypatch.undo()


_GUARD_SAMPLE = ("import re\n"
                 "MIN_MD_FILES = 5\n"
                 "MIN_LINKS_LOCAL = 12  # with the working half on disk\n"
                 "MIN_LINKS_CI = 6\n"
                 "MIN_ROWS = 8\n"
                 "PUBLIC_MD_MAX_LINES = 35\n")


def test_the_helper_rewrites_only_the_numbers_it_is_given():
    helper = _helper()
    assert helper.rewrite(_GUARD_SAMPLE, {"MIN_MD_FILES": 21, "MIN_LINKS_CI": 9}) == (
        "import re\n"
        "MIN_MD_FILES = 21\n"
        "MIN_LINKS_LOCAL = 12  # with the working half on disk\n"
        "MIN_LINKS_CI = 9\n"
        "MIN_ROWS = 8\n"
        "PUBLIC_MD_MAX_LINES = 35\n"
    )
    every = {"MIN_MD_FILES": 40, "MIN_LINKS_LOCAL": 50, "MIN_LINKS_CI": 30, "MIN_ROWS": 7}
    assert helper.rewrite(_GUARD_SAMPLE, every) == (
        "import re\n"
        "MIN_MD_FILES = 40\n"
        "MIN_LINKS_LOCAL = 50  # with the working half on disk\n"
        "MIN_LINKS_CI = 30\n"
        "MIN_ROWS = 7\n"
        "PUBLIC_MD_MAX_LINES = 35\n"
    )


def test_the_helper_refuses_a_guard_it_does_not_understand():
    helper = _helper()
    missing_one = _GUARD_SAMPLE.replace("MIN_LINKS_CI = 6\n", "")
    with pytest.raises(SystemExit):
        helper.rewrite(missing_one, {"MIN_LINKS_CI": 9})
    defined_twice = _GUARD_SAMPLE + "MIN_ROWS = 9\n"
    with pytest.raises(SystemExit):
        helper.rewrite(defined_twice, {"MIN_ROWS": 7})
    with pytest.raises(SystemExit):
        helper.rewrite(_GUARD_SAMPLE, {"PUBLIC_MD_MAX_LINES": 99})


def test_check_mode_writes_nothing():
    helper = _helper()
    guard_file = ROOT / "tests" / "test_docs_integrity.py"
    before = guard_file.read_bytes()
    try:
        helper.main(["--check"])
    except SystemExit as exc:
        assert exc.code in (0, None), f"--check exited with {exc.code} on a repo whose floors fit"
    assert guard_file.read_bytes() == before, "--check changed the guard"


def test_a_floor_fits_from_half_the_count_up_to_the_count():
    helper = _helper()
    assert [helper.fits(floor, 20) for floor in (9, 10, 15, 20, 21)] == [False, True, True, True, False]
    # A count of one or two has no room for "half": only "not above the count" applies.
    assert helper.fits(1, 2) and helper.fits(1, 1) and not helper.fits(2, 1)


def test_check_mode_fails_when_a_floor_does_not_fit(monkeypatch):
    helper = _helper()
    for unfit in (10 ** 6, 0):
        monkeypatch.setattr(guard, "MIN_MD_FILES", unfit)
        with pytest.raises(SystemExit) as caught:
            helper.main(["--check"])
        assert caught.value.code not in (0, None), f"--check accepted a floor of {unfit}"


def test_a_floor_this_state_cannot_measure_is_left_alone(monkeypatch, capsys):
    """Without the working half on disk, two floors cannot be measured. Whatever they hold,
    --check must not judge them, and a rewrite must not touch them."""
    if guard._local_mode():
        return
    helper = _helper()
    monkeypatch.setattr(guard, "MIN_ROWS", 10 ** 6)
    monkeypatch.setattr(guard, "MIN_LINKS_LOCAL", 10 ** 6)
    try:
        helper.main(["--check"])
    except SystemExit as exc:
        assert exc.code in (0, None), "--check judged a floor it cannot measure here"
    assert "not measurable" in capsys.readouterr().out


def test_the_committed_floors_fit_this_repo():
    """No floor above its real count, and none left at a size the repo has long outgrown.

    A floor under half the real count would let half the files vanish without a word. Run
    `python scripts/set_floors.py` after a large addition; it sets each floor to three
    quarters. Only the floors this state can measure are checked here.
    """
    for name, count in _helper().measure().items():
        floor = getattr(guard, name)
        assert floor <= count, f"{name} = {floor} is above the real count {count}"
        assert floor * 2 >= count or count <= 2, (
            f"{name} = {floor} is under half the real count {count}: "
            f"run `python scripts/set_floors.py`"
        )

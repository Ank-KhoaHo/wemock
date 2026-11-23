"""Tests of the docs guard itself, and of the helper that sets its floors.

A guard nobody tests can go blind and still report green. Each test here states one thing the
guard must keep doing, and fails when that thing stops:

* a link inside a fenced block is checked, unless the fence is code or is marked as an illustration
* the walk sees a file that is not committed yet, and skips a gitignored one
* `scripts/set_floors.py` counts exactly what the guard counts, and rewrites only the numbers
* `.editorconfig` and `.gitattributes` agree on which files need CRLF
* the pull request template holds no relative link, because a PR body is rendered from another base
* an open question names its default, no question number is used twice, and a question the
  check cannot read (another heading, a list item) is reported
* the changelog's newest released block and the `VERSION` file agree
* no heading of the README is empty, `CLAUDE.md` stays under its cap, and a very long source
  file is warned about
* a ticket that is DONE says what it taught, under a `## Lessons` heading

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


# ---------------------------------------------------------------- line endings


def _crlf_extensions_in_gitattributes() -> list[str]:
    extensions = []
    for line in (ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\*\.(\w+)\s+.*\beol=crlf\b", line)
        if match:
            extensions.append(match.group(1))
    return extensions


def _crlf_extensions_in_editorconfig() -> set[str]:
    extensions: set[str] = set()
    current: list[str] = []
    for raw in (ROOT / ".editorconfig").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        header = re.match(r"^\[(.+)\]$", line)
        if header:
            glob = header.group(1)
            braces = re.match(r"^\*\.\{([^}]+)\}$", glob)
            single = re.match(r"^\*\.(\w+)$", glob)
            current = ([part.strip() for part in braces.group(1).split(",")] if braces
                       else [single.group(1)] if single else [])
        elif re.match(r"^end_of_line\s*=\s*crlf$", line):
            extensions.update(current)
    return extensions


def test_editorconfig_agrees_with_gitattributes_on_crlf():
    pinned = _crlf_extensions_in_gitattributes()
    missing = [ext for ext in pinned if ext not in _crlf_extensions_in_editorconfig()]
    assert missing == [], (
        f".gitattributes pins {missing} to CRLF and .editorconfig does not: an editor "
        f"would save those files with LF, and git would then rewrite every line"
    )


# ---------------------------------------------------------------- the pull request template


def test_the_pull_request_template_has_no_relative_link():
    template = ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md"
    if not template.exists():
        return
    relative = [target for _, target in guard._iter_markdown_links(template.read_text(encoding="utf-8"))
                if not re.match(r"^(?:https?:|mailto:|#)", target)]
    assert relative == [], (
        f"relative links in the pull request template: {relative}. GitHub renders a PR body "
        f"from another base, so they break there; name the file as plain text instead"
    )


def _doc(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _scratch_root(monkeypatch, folder: Path, files: dict[str, str]) -> None:
    """Point the guard at a folder that holds exactly these files.

    These tests are about the guard, not about this repository. A project is free to delete
    QUESTIONS.md, ROADMAP.md or VERSION, and a test that leaned on the real file would then
    fail for a reason that has nothing to do with what it checks.
    """
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8", newline="\n")
    monkeypatch.setattr(guard, "_repo_root", lambda: folder)


# ---------------------------------------------------------------- open questions


@pytest.fixture(autouse=True)
def _the_question_examples_start_at_the_first_question(monkeypatch):
    """A project that took the rule late raises QUESTIONS_RULE_FROM. The examples in this file
    use small numbers, so each one starts from the first question, whatever the project set."""
    monkeypatch.setattr(guard, "QUESTIONS_RULE_FROM", 1)


def test_a_question_without_a_default_is_reported():
    problems = guard._question_problems(_doc(
        "# Open questions", "",
        "## Q1 — Which colour?", "", "**Asked:** today.", "", "**Default taken:** blue.", "",
        "## Q2 — Which size?", "", "**Asked:** today.", "",
        "## Q3 — Which font?", "", "**Default taken:**", "",
    ))
    assert len(problems) == 2, problems
    assert "Q2" in problems[0] and "default" in problems[0]
    assert "Q3" in problems[1], "a bare label with nothing after it was taken for a default"


def test_a_question_number_used_twice_is_reported():
    problems = guard._question_problems(_doc(
        "## Q4 — One thing?", "", "**Default taken:** yes.", "",
        "## Q4 — Another thing?", "", "**Default taken:** no.", "",
    ))
    assert len(problems) == 1 and "Q4" in problems[0] and "twice" in problems[0], problems


def test_a_question_shown_as_an_example_is_not_a_question():
    text = _doc(
        "# Open questions", "", "The shape:", "",
        "```", "## Q1 — the question", "", "**Default taken:** the default.", "```", "",
        "## Q1 — A real one?", "", "**Default taken:** yes.", "",
    )
    assert guard._question_problems(text) == []


def test_a_default_under_another_heading_does_not_count():
    problems = guard._question_problems(_doc(
        "## Q5 — Which one?", "", "## Notes", "", "**Default taken:** the first.", "",
    ))
    assert len(problems) == 1 and "Q5" in problems[0], problems


def test_a_sound_questions_file_has_no_problem():
    assert guard._question_problems(_doc("# Open questions", "", "Nothing open.")) == []


def test_a_question_without_a_default_fails_the_guard(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {"QUESTIONS.md": _doc("## Q9 — Which?", "", "**Asked:** today.")})
    with pytest.raises(AssertionError, match="Q9"):
        guard.test_every_open_question_names_its_default()


def test_a_question_heading_the_check_cannot_read_is_reported():
    """A heading with letters before its number passed unseen in one project. The check read
    `## Q<number>` and nothing else, so a question under any other heading was never asked
    for its default."""
    problems = guard._question_problems(_doc(
        "# Open questions", "",
        "## Q-A9082 — Which border?", "", "Default taken: thin.", "",
        "## Q12b — Which size?", "", "**Default taken:** small.", "",
        "## Q 7 — Which font?", "", "**Default taken:** serif.", "",
        "## Q: Which colour?", "", "**Default taken:** blue.", "",
        "## Q", "", "**Default taken:** none.", "",
    ))
    assert len(problems) == 5, problems
    assert all("Q<number>" in problem for problem in problems), problems
    for problem, line, heading in zip(problems, (3, 7, 11, 15, 19),
                                      ("## Q-A9082 — Which border?", "## Q12b — Which size?", "## Q 7 — Which font?",
                                       "## Q: Which colour?", "## Q")):
        assert f"line {line}:" in problem and f"'{heading}'" in problem, problem


def test_a_heading_that_only_begins_with_q_is_not_a_question():
    """`Questions`, `Quick notes`, `QA` and `Q&A` are words. Only `Q` alone, or `Q` followed by
    a digit or one of `-:.#_`, reads like a question that lost its number."""
    assert guard._question_problems(_doc(
        "# Open questions", "",
        "## Questions answered this week", "", "None.", "",
        "## Quick notes", "", "Text.", "",
        "## QA", "", "Text.", "",
        "## Q&A", "", "Text.", "",
        "### Q-A9082 — a level-3 heading is not read", "", "Text.", "",
    )) == []


def test_a_heading_the_check_cannot_read_ends_the_question_above_it():
    problems = guard._question_problems(_doc(
        "## Q5 — Which one?", "", "**Asked:** today.", "",
        "## Q-6 — And this?", "", "**Default taken:** the first.", "",
    ))
    assert len(problems) == 2, problems
    assert "Q5 names no default" in problems[0], "the default under the unreadable heading was given to Q5"
    assert "line 5:" in problems[1] and "Q<number>" in problems[1], problems


def test_a_question_written_as_a_list_item_is_reported():
    """One project kept its questions as bullets under a plain heading. The check found no
    `## Q` heading, read nothing, and passed for weeks."""
    problems = guard._question_problems(_doc(
        "# Open questions", "",
        "## Waiting", "",
        "- **Q66** Which colour for the border (default: grey).",
        "* Q67 Does the panel remember its width (default: yes).",
        "  + **Q68:** Which key opens it.",
        "1. Q69 — Light or dark first.",
        "2) **Q70** How long a notice stays.",
    ))
    assert len(problems) == 5, problems
    for problem, line, number in zip(problems, (5, 6, 7, 8, 9), (66, 67, 68, 69, 70)):
        assert f"line {line}:" in problem and f"Q{number} is written as a list item" in problem, problem
        assert f"`## Q{number}`" in problem, "the sentence does not say how to fix it"


def test_a_list_item_that_only_mentions_a_question_is_not_one():
    assert guard._question_problems(_doc(
        "# Open questions", "",
        "- See Q12 in the archive.",
        "- Answered: Q13 and Q14.",
        "Q15 is answered, in a plain line.",
        "- Quick notes, not a question.",
        "- Q&A is on the picker.",
        "",
        "## Q16 — Which one?", "", "**Default taken:** the first.", "",
        "**Options:**", "",
        "- Q12 asked the same of the old screen.",
        "1. **Q13** is the other way to read it.",
        "",
        "```", "- **Q17** shown as an example", "```",
    )) == []


def test_the_rule_can_start_at_a_number(monkeypatch):
    """One project had hundreds of questions older than the rule, in other words and other
    shapes. A rule that lands late needs a start line, or it lands as a skip. Numbers stay
    unique all the same."""
    text = _doc(
        "## Q266 — Old?", "", "Default: yes.", "",
        "## Q267 — Old too?", "",
        "- **Q12** an old one, kept as a bullet.",
        "",
        "## Notes", "",
        "- **Q13** another old one.",
        "- **Q268** a new one, as a bullet.",
        "",
        "## Q268 — New?", "", "**Asked:** today.", "",
        "## Q269 — Newer?", "", "**Default taken:** yes.", "",
        "## Q266 — The old number again?", "",
    )
    monkeypatch.setattr(guard, "QUESTIONS_RULE_FROM", 268)
    problems = guard._question_problems(text)
    assert len(problems) == 3, problems
    assert "line 12:" in problems[0] and "Q268 is written as a list item" in problems[0], problems
    assert "Q268 names no default" in problems[1], problems
    assert "Q266 is used twice" in problems[2], problems

    monkeypatch.setattr(guard, "QUESTIONS_RULE_FROM", 1)
    assert len(guard._question_problems(text)) == 7, "with no start line, every old question is asked too"


def test_a_heading_the_check_cannot_read_is_reported_whatever_the_start_line(monkeypatch):
    monkeypatch.setattr(guard, "QUESTIONS_RULE_FROM", 500)
    problems = guard._question_problems(_doc("## Q-A9082 — Which border?", "", "Default taken: thin."))
    assert len(problems) == 1 and "Q<number>" in problems[0], problems


def test_the_start_line_is_a_whole_number_from_one_up():
    """Read from the file, not from the module: the fixture above sets the module's value."""
    source = Path(guard.__file__).read_text(encoding="utf-8")
    found = re.findall(r"^QUESTIONS_RULE_FROM(?:\s*:\s*int)?\s*=\s*(\S+)\s*$", source, re.M)
    assert len(found) == 1, f"expected one QUESTIONS_RULE_FROM line in the guard, found {len(found)}"
    assert found[0].isdigit() and int(found[0]) >= 1, f"QUESTIONS_RULE_FROM is {found[0]}"


# ---------------------------------------------------------------- the changelog and the version


def test_the_released_versions_are_read_in_order():
    changelog = _doc(
        "# Changelog", "", "A block looks like `## 0.1.0 — 2026-01-31`.", "",
        "```", "## 9.9.9 — an example", "```", "",
        "## Unreleased", "", "- a thing", "",
        "## 0.2.0 — 2026-02-10", "", "- more", "",
        "## 0.1.0 — 2026-01-31", "", "- first",
    )
    assert guard._released_versions(changelog) == ["0.2.0", "0.1.0"]


def test_a_new_project_with_nothing_released_is_sound():
    changelog = _doc("# Changelog", "", "## Unreleased", "", "- Project created.")
    assert guard._version_problems(changelog, "0.1.0\n") == []


def test_the_newest_block_must_be_the_version_file():
    changelog = _doc("## Unreleased", "", "## 0.2.0 — 2026-02-10", "", "- more", "", "## 0.1.0 — 2026-01-31", "", "- first")
    assert guard._version_problems(changelog, "0.2.0\n") == []
    problems = guard._version_problems(changelog, "0.3.0\n")
    assert len(problems) == 1 and "0.2.0" in problems[0] and "0.3.0" in problems[0], problems


def test_versions_are_compared_as_numbers_and_newest_first():
    older_first = _doc("## 0.1.0 — a", "", "- x", "", "## 0.2.0 — b", "", "- y")
    assert any("newest first" in p for p in guard._version_problems(older_first, "0.1.0\n"))
    # 0.10.0 is newer than 0.9.0: compared as text it would look older.
    numeric = _doc("## 0.10.0 — a", "", "- x", "", "## 0.9.0 — b", "", "- y")
    assert guard._version_problems(numeric, "0.10.0\n") == []


def test_a_version_listed_twice_and_a_broken_version_file_are_reported():
    twice = _doc("## 0.2.0 — a", "", "- x", "", "## 0.2.0 — b", "", "- y")
    assert any("two blocks" in p for p in guard._version_problems(twice, "0.2.0\n"))
    problems = guard._version_problems(_doc("## Unreleased"), "version one\n")
    assert len(problems) == 1 and "VERSION" in problems[0], problems


def test_a_changelog_that_disagrees_with_the_version_file_fails_the_guard(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {
        "CHANGELOG.md": _doc("## 0.2.0 — 2026-02-10", "", "- more"),
        "VERSION": _doc("0.1.0"),
    })
    with pytest.raises(AssertionError, match="0.2.0"):
        guard.test_the_changelog_and_the_version_file_agree()
    (tmp_path / "VERSION").write_text(_doc("0.2.0"), encoding="utf-8", newline="\n")
    guard.test_the_changelog_and_the_version_file_agree()


def test_a_project_that_deleted_those_files_still_passes(monkeypatch, tmp_path):
    """They are the project's to delete. The guard must then have nothing to say, and must
    not fail for want of a file."""
    _scratch_root(monkeypatch, tmp_path, {})
    guard.test_every_open_question_names_its_default()
    guard.test_the_changelog_and_the_version_file_agree()


import subprocess  # noqa: E402


# ---------------------------------------------------------------- placeholders


def test_every_placeholder_in_the_tree_is_one_the_guard_looks_for():
    """A new placeholder is added in two places: the file that carries it, and the guard's
    list. Forget the list, and a project where the token was never filled in passes.

    After a project is made there is no token left, and this has nothing to compare; it is
    the template, where a placeholder is introduced, that it protects. The seed is read too:
    init fills the same tokens there as it installs it.
    """
    token = re.compile(r"<[A-Z]+(?:[_-][A-Z]+)+>")
    known = set(guard.PLACEHOLDERS) | {guard.LICENCE_TOKEN}
    files = guard._scannable("*.md", "*.py", "*.html", "*.yml", "*.yaml",
                             ".gitignore", ".gitattributes", ".editorconfig")
    read, unknown = 0, set()
    for rel in files:
        if rel in guard.PLACEHOLDER_EXEMPT or (rel.startswith("template/") and not rel.startswith(guard.SEED_PREFIX)):
            continue
        read += 1
        unknown |= {found for found in token.findall(guard._read(rel)) if found not in known}
    assert read > 0, "no file was read: the scan is vacuous"
    assert unknown == set(), (
        f"{sorted(unknown)} look like placeholders, and tests/test_docs_integrity.py does not "
        f"look for them: add each to PLACEHOLDERS, and to the answers scripts/init_project.py fills in"
    )


# ---------------------------------------------------------------- the README


def test_a_readme_heading_with_nothing_under_it_fails_the_guard(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, {"README.md": _doc("# Widget Forge", "", "It forges.", "", "## How to run it")})
    with pytest.raises(AssertionError, match="How to run it"):
        guard.test_the_readme_has_no_empty_heading()
    (tmp_path / "README.md").write_text(
        _doc("# Widget Forge", "", "It forges.", "", "## How to run it", "", "Nothing runs yet."),
        encoding="utf-8", newline="\n")
    guard.test_the_readme_has_no_empty_heading()


# ---------------------------------------------------------------- size caps


def test_claude_md_is_capped_at_three_hundred_lines(monkeypatch, tmp_path):
    """Every session reads CLAUDE.md whole. One project's had grown to 2,031 lines."""
    _scratch_root(monkeypatch, tmp_path, {"CLAUDE.md": _doc(*["a line"] * 300)})
    guard.test_claude_md_stays_short()
    (tmp_path / "CLAUDE.md").write_text(_doc(*["a line"] * 301), encoding="utf-8", newline="\n")
    with pytest.raises(AssertionError, match="301"):
        guard.test_claude_md_stays_short()
    (tmp_path / "CLAUDE.md").unlink()
    guard.test_claude_md_stays_short()          # a project with no CLAUDE.md has nothing to cap


def _scratch_repo(monkeypatch, folder: Path, files: dict[str, int]) -> None:
    """A git repository whose files have the given numbers of lines. Nothing is committed:
    the guard's walk sees a file before it is committed."""
    subprocess.run(["git", "init", "-q"], cwd=folder, check=True, capture_output=True)
    for name, count in files.items():
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(_doc(*["x = 1"] * count), encoding="utf-8", newline="\n")
    monkeypatch.setattr(guard, "_repo_root", lambda: folder)


def test_only_source_files_over_the_limit_are_listed(monkeypatch, tmp_path):
    _scratch_repo(monkeypatch, tmp_path, {
        "src/big.py": 2001, "src/at_the_limit.py": 2000, "src/small.gd": 10,
        ".github/workflows/ci.yml": 2500,     # a workflow is source: one grew to 3,407 lines
        "docs/long-notes.md": 5000,           # prose is not
        "BACKLOG.html": 5000,                 # nor is a generated page
        "data/table.json": 9000, "data/rows.csv": 9000,
    })
    assert guard._long_source_files(2000) == [(".github/workflows/ci.yml", 2500), ("src/big.py", 2001)]


def test_a_file_that_is_not_text_is_never_counted(monkeypatch, tmp_path):
    _scratch_repo(monkeypatch, tmp_path, {"src/small.py": 3})
    (tmp_path / "model.bin").write_bytes(bytes([0, 159, 146, 150]) * 4000 + (chr(10) * 3000).encode())
    # A NUL byte is valid UTF-8, so "it decodes" is not enough to call a file text.
    (tmp_path / "table.dat").write_bytes(bytes([0]) + (chr(10) * 3000).encode())
    assert guard._long_source_files(2000) == []


def test_a_very_long_source_file_is_a_warning_not_a_failure(monkeypatch, tmp_path):
    """Splitting a file is a decision, so this warns. It names the file and its length."""
    _scratch_repo(monkeypatch, tmp_path, {"src/big.py": 2400})
    with pytest.warns(UserWarning, match=r"src/big\.py.*2400"):
        guard.test_no_source_file_has_grown_past_two_thousand_lines()


def test_no_warning_when_every_file_is_short(monkeypatch, tmp_path):
    import warnings

    _scratch_repo(monkeypatch, tmp_path, {"src/small.py": 30})
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        guard.test_no_source_file_has_grown_past_two_thousand_lines()


# ---------------------------------------------------------------- what a finished ticket taught


def _ticket(tid: str, status: str, *after: str) -> str:
    return _doc(f"# {tid}", "", f"**Status:** {status}", "", "**Section:** A — Test section", "",
                "## Detail", "", f"**Summary of {tid}**", "", "Body.", *after)


def _scratch_specs(monkeypatch, folder: Path, specs: dict[str, str]) -> None:
    target = folder / "docs" / "superpowers" / "specs"
    target.mkdir(parents=True)
    for name, text in specs.items():
        (target / name).write_text(text, encoding="utf-8", newline="\n")
    monkeypatch.setattr(guard, "_repo_root", lambda: folder)
    # A project that took the rule late lists its old tickets in LESSONS_EXEMPT. The scratch
    # tree is not that project: it starts with no exempt ticket, whatever the project lists.
    monkeypatch.setattr(guard, "LESSONS_EXEMPT", frozenset())


def test_the_examples_here_do_not_read_the_projects_own_exempt_list(monkeypatch, tmp_path):
    """Both projects that took this file saw the examples below fail that day. Each had
    listed its old tickets in LESSONS_EXEMPT, and an example used one of those IDs."""
    monkeypatch.setattr(guard, "LESSONS_EXEMPT", frozenset({"A9003", "A9004"}))
    _scratch_specs(monkeypatch, tmp_path, {"A9003-old.md": _ticket("A9003", "DONE")})
    assert guard._done_tickets_without_lessons() == ["A9003"]


def test_only_a_done_ticket_without_lessons_is_reported(monkeypatch, tmp_path):
    """Most lessons were found buried in the review notes of a ticket, where nobody looks.
    A finished ticket says what it taught, in one place, under one heading."""
    _scratch_specs(monkeypatch, tmp_path, {
        "A9001-with-a-lesson.md": _ticket("A9001", "DONE", "", "## Lessons", "", "Measure before choosing."),
        "A9002-none-is-an-answer.md": _ticket("A9002", "DONE", "", "## Lessons", "", "None."),
        "A9003-no-heading.md": _ticket("A9003", "DONE"),
        "A9004-empty-heading.md": _ticket("A9004", "DONE", "", "## Lessons", ""),
        "A9005-heading-then-another.md": _ticket("A9005", "DONE", "", "## Lessons", "", "## Review", "", "Notes."),
        "A9006-only-in-an-example.md": _ticket("A9006", "DONE", "", "```", "## Lessons", "", "Shown, not written.", "```"),
        "A9007-not-finished.md": _ticket("A9007", "BUILT"),
        "A9008-not-started.md": _ticket("A9008", "ACCEPTED"),
        "A9009-declined.md": _ticket("A9009", "DROPPED"),
        "A9010-said-twice.md": _ticket("A9010", "DONE", "", "## Lessons", "", "## Lessons", "", "Measure first."),
        # One shape only, so that one search finds every lesson in the backlog.
        "A9099-wrong-level.md": _ticket("A9099", "DONE", "", "## Review", "", "### Lessons", "", "Too deep to find."),
        # Its heading reads like an ID on purpose: only the dated file name says it is no ticket.
        "2026-01-01-a-design.md": _doc("# Design", "", "**Status:** DONE"),
    })
    assert guard._done_tickets_without_lessons() == ["A9003", "A9004", "A9005", "A9006", "A9099"]


def test_a_ticket_closed_before_the_rule_can_be_exempt(monkeypatch, tmp_path):
    _scratch_specs(monkeypatch, tmp_path, {"A9003-old.md": _ticket("A9003", "DONE"), "A9004-new.md": _ticket("A9004", "DONE")})
    monkeypatch.setattr(guard, "LESSONS_EXEMPT", frozenset({"A9003"}))
    assert guard._done_tickets_without_lessons() == ["A9004"]


def test_a_finished_ticket_without_lessons_fails_the_guard(monkeypatch, tmp_path):
    _scratch_specs(monkeypatch, tmp_path, {"A9003-no-heading.md": _ticket("A9003", "DONE")})
    with pytest.raises(AssertionError, match="A9003"):
        guard.test_every_done_ticket_says_what_it_taught()
    (tmp_path / "docs" / "superpowers" / "specs" / "A9003-no-heading.md").write_text(
        _ticket("A9003", "DONE", "", "## Lessons", "", "None."), encoding="utf-8", newline="\n")
    guard.test_every_done_ticket_says_what_it_taught()


def test_a_tree_without_specs_says_it_did_not_look(monkeypatch, tmp_path, capsys):
    """A clone holds no specs. The guard must say that it did not look, not pass in silence."""
    monkeypatch.setattr(guard, "_repo_root", lambda: tmp_path)
    assert guard._done_tickets_without_lessons() == []
    guard.test_every_done_ticket_says_what_it_taught()
    assert "[CI]" in capsys.readouterr().out, "nothing was checked, and nothing said so"


# ---------------------------------------------------------------- a dated design document


def test_a_dated_design_document_among_the_specs_is_not_a_ticket(monkeypatch, tmp_path):
    """The builder and the leak check leave such a document out. The check that holds the page
    to the specs read it for a ticket's ID and status, found neither, and stopped with an error
    of Python's own, which names no file."""
    _scratch_specs(monkeypatch, tmp_path, {
        "A9003-a-ticket.md": _ticket("A9003", "OPEN"),
        "2026-01-31-a-design.md": "# A design\n\nIt has no status line.\n",
    })
    (tmp_path / "BACKLOG.html").write_text(
        '<table><tr data-id="A9003"><td><span class="chip chip-open">OPEN</span></td></tr></table>\n',
        encoding="utf-8", newline="\n")
    guard.test_the_index_still_agrees_with_its_source()

    (tmp_path / "docs" / "superpowers" / "specs" / "A9004-another.md").write_text(
        _ticket("A9004", "OPEN"), encoding="utf-8", newline="\n")
    with pytest.raises(AssertionError, match="A9004"):
        guard.test_the_index_still_agrees_with_its_source()


# ---------------------------------------------------------------- two lines of the checklist


def test_the_checklist_keeps_the_two_lines_that_each_cost_a_bad_commit(capsys):
    """A commit made after a failed gate, and a stale compiled file that failed a sound one.
    The checklist says how to avoid both. It is working material: a clone has none, and this
    says that it did not look."""
    here = [path for path in (ROOT / "DEVELOPMENT-CHECKLIST.md", ROOT / "template" / "seed" / "DEVELOPMENT-CHECKLIST.md")
            if path.is_file()]
    if not here:
        print("[CI] no DEVELOPMENT-CHECKLIST.md in this tree: its two lines were not looked at")
        return
    for path in here:
        checklist = path.read_text(encoding="utf-8")
        assert "python scripts/check.py && git commit" in checklist, (
            f"{path.name} no longer chains the commit to the gate with `&&`")
        assert "PYTHONDONTWRITEBYTECODE=1" in checklist, (
            f"{path.name} no longer says how to plant a bug in a Python file without a stale compiled copy")


def test_the_checklist_says_what_a_planted_bug_proves_and_how_to_write_one(capsys):
    """Plants that changed nothing a person could see were counted as missed faults. And a
    shell's heredoc took one backslash of each pair, so a plant found no target: a plant that
    changes nothing looks like a rule that holds."""
    here = [path for path in (ROOT / "DEVELOPMENT-CHECKLIST.md", ROOT / "template" / "seed" / "DEVELOPMENT-CHECKLIST.md")
            if path.is_file()]
    if not here:
        print("[CI] no DEVELOPMENT-CHECKLIST.md in this tree: its words on planted bugs were not looked at")
        return
    # Each sentence is held by its own words. This test once looked for the word `heredoc`,
    # which the next sentence says too: every project found that the rule itself could go.
    for path in here:
        checklist = " ".join(path.read_text(encoding="utf-8").split())
        for words, what in (
                ("changes nothing a person can see", "that a plant which changes nothing a person can see is not a missed fault"),
                ("with a file tool", "to write a plant with a file tool"),
                ("never through a shell's heredoc", "that a plant is never written through a shell's heredoc")):
            assert words in checklist, f"{path.name} no longer says {what}"


def test_the_checklist_says_how_to_run_a_plant_and_what_a_cleanup_by_name_costs(capsys):
    """A caught fault was called missed: the word given to `-k` selected none of the test that
    held the rule. A plant changed nothing: its target stood in two places and the tool
    stopped. And a cleanup removes a container by a fixed name, so two gates of one project
    on one machine would remove each other's."""
    here = [path for path in (ROOT / "DEVELOPMENT-CHECKLIST.md", ROOT / "template" / "seed" / "DEVELOPMENT-CHECKLIST.md")
            if path.is_file()]
    if not here:
        print("[CI] no DEVELOPMENT-CHECKLIST.md in this tree: its words on running a plant were not looked at")
        return
    for path in here:
        checklist = " ".join(path.read_text(encoding="utf-8").split())
        for words, what in (
                ("a test named in full", "to run a plant against the whole test file, or a test named in full"),
                ("Count the places", "to count the places a plant's target stands in"),
                ("one gate of a project at a time", "to run one gate of a project at a time on one machine")):
            assert words in checklist, f"{path.name} no longer says {what}"


# ---------------------------------------------------------------- a code span is not a link


def test_link_shaped_text_inside_a_code_span_is_not_a_link():
    """A type in square brackets and a number in round ones, written as code, was read as a
    link to a file named `3`."""
    assert _targets("call `Step[str](3)` and then [the guide](guide.md)\n") == ["guide.md"]
    assert _targets("`[a](one.md)` and `[b](two.md)` and [c](three.md)\n") == ["three.md"]
    assert _targets("``a span with a ` inside: [x](gone.md)`` then [real](real.md)\n") == ["real.md"]


def test_a_link_whose_text_is_a_code_span_is_still_a_link():
    text = "see [`tools/check.py`](tools/check.py) and [`a` and `b`](both.md)\n"
    assert _targets(text) == ["tools/check.py", "both.md"]


def test_a_backtick_with_no_partner_hides_nothing():
    assert _targets("a lone ` and then [x](still-checked.md)\n") == ["still-checked.md"]
    assert _targets("[x](first.md) and a lone ` at the end\n") == ["first.md"]


def test_a_code_span_inside_a_scanned_fence_is_left_out_too():
    text = "```\n`table[key](3)` and [b](inside.md)\n```\n"
    assert _targets(text) == ["inside.md"]
    assert list(guard._iter_markdown_links("intro\n\n`x[y](3)` [c](after.md)\n")) == [(3, "after.md")]


def test_a_code_span_does_not_fail_the_guard():
    probe = ROOT / "zz-selftest-code-span.md"
    try:
        probe.write_text("# probe\n\nA step is written `Step[str](3)` here.\n", encoding="utf-8", newline="\n")
        guard.test_every_markdown_link_resolves()
    finally:
        probe.unlink(missing_ok=True)


# ---------------------------------------------------------------- a release heading in brackets


_KEEP_A_CHANGELOG = ("# Changelog\n\n## [Unreleased]\n\n### Added\n\n- something new\n\n"
                     "## [0.2.0] - 2026-11-01\n\n### Added\n\n- a thing\n\n"
                     "## [0.1.0] - 2026-10-01\n\n- the first build\n")


def test_a_release_heading_in_brackets_is_a_release():
    """Keep a Changelog writes `## [0.2.0] - date`. With that changelog the version check
    compared nothing, and nothing said so."""
    assert guard._released_versions(_KEEP_A_CHANGELOG) == ["0.2.0", "0.1.0"]
    assert guard._version_problems(_KEEP_A_CHANGELOG, "0.2.0\n") == []
    problems = guard._version_problems(_KEEP_A_CHANGELOG, "0.3.0\n")
    assert len(problems) == 1 and "0.2.0" in problems[0] and "0.3.0" in problems[0], problems


def test_a_bracket_that_holds_no_version_is_not_a_release():
    changelog = "## [Unreleased]\n\n## [v0.3.0]\n\n## [next] 0.4.0\n\n## 0.1.0 (2026-10-01)\n"
    assert guard._released_versions(changelog) == ["0.1.0"]

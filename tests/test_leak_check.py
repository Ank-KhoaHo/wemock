"""Tests of scripts/check_leaks.py: this project's own private words come from a file git never sees.

The script is tracked in a public repository, so a private word written into it would publish
the very thing it exists to keep out. The words live in `.leak-patterns.local` instead: one
regular expression per line, gitignored, read at scan time.
"""

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_leaks  # noqa: E402

PATTERNS_FILE = ".leak-patterns.local"
_IDENTITY = ("-c", "user.name=Leak Test", "-c", "user.email=leak-test@example.com")


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *_IDENTITY, *args], cwd=repo, check=True, capture_output=True,
                   text=True, encoding="utf-8", errors="replace")


def _repo(tmp_path: Path, staged_text: str, commit_message: str = "Start") -> Path:
    """A repository with one clean commit and one staged file."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / ".gitignore").write_text("/.leak-patterns.local\n", encoding="utf-8", newline="\n")
    _git(repo, "add", ".gitignore")
    _git(repo, "commit", "-q", "-m", commit_message)
    (repo / "notes.txt").write_text(staged_text, encoding="utf-8", newline="\n")
    _git(repo, "add", "notes.txt")
    return repo


def _scan(repo: Path, monkeypatch, capsys) -> tuple[int, str]:
    monkeypatch.setattr(check_leaks, "ROOT", repo)
    monkeypatch.setattr(check_leaks, "LOCAL_PATTERNS_FILE", repo / PATTERNS_FILE)
    code = check_leaks.main()
    return code, capsys.readouterr().out


def _write_patterns(repo: Path, text: str) -> None:
    (repo / PATTERNS_FILE).write_text(text, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------- reading the file


def test_no_patterns_file_means_no_extra_patterns(tmp_path):
    assert check_leaks.load_local_patterns(tmp_path / PATTERNS_FILE) == []


def test_blank_lines_and_comments_are_skipped(tmp_path):
    path = tmp_path / PATTERNS_FILE
    path.write_text("# one word per line\n\n  bluebird  \nproject[- ]x\n", encoding="utf-8", newline="\n")
    assert check_leaks.load_local_patterns(path) == ["bluebird", "project[- ]x"]


def test_a_pattern_that_does_not_compile_stops_the_load(tmp_path):
    path = tmp_path / PATTERNS_FILE
    path.write_text("bluebird\n(unclosed\n", encoding="utf-8", newline="\n")
    with pytest.raises(ValueError, match="line 2"):
        check_leaks.load_local_patterns(path)


# ---------------------------------------------------------------- the scan uses it


def test_a_local_pattern_catches_a_private_word_in_the_staged_diff(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path, "the Bluebird launch plan\n")
    _write_patterns(repo, "bluebird\n")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 1
    assert "staged diff: matched /bluebird/" in out
    assert "launch plan" not in out, "the scan printed the line it matched: the leak moved into the log"


def test_without_the_file_the_same_diff_is_clean(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path, "the Bluebird launch plan\n")
    code, _ = _scan(repo, monkeypatch, capsys)
    assert code == 0


def test_a_local_pattern_catches_a_private_word_in_a_commit_message(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path, "nothing to see\n", commit_message="Notes for Bluebird")
    _write_patterns(repo, "bluebird\n")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 1
    assert "unpushed commit message: matched /bluebird/" in out


def test_a_broken_patterns_file_fails_the_scan_instead_of_passing(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path, "nothing to see\n")
    _write_patterns(repo, "(unclosed\n")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 2, "a pattern that cannot compile must stop the scan, not read as clean"
    assert "line 1" in out


# ---------------------------------------------------------------- the file itself stays private


def test_the_patterns_file_is_ignored_and_never_tracked():
    ignored = subprocess.run(["git", "check-ignore", "-q", "--no-index", PATTERNS_FILE],
                             cwd=ROOT, capture_output=True)
    assert ignored.returncode == 0, f"{PATTERNS_FILE} is not covered by .gitignore"
    tracked = subprocess.run(["git", "ls-files", "--", PATTERNS_FILE], cwd=ROOT,
                             capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert (tracked.stdout or "").strip() == "", f"{PATTERNS_FILE} is tracked: its words publish on the next push"


# ---------------------------------------------------------------- what only code must not say
#
# A ticket ID in public code points at a backlog nobody outside can open, and the name of the
# tool that wrote a line explains nothing about the line. Both are refused in staged CODE.
# A commit message may cite a ticket: that harms nobody, and it is how history is searched.


def _repo_with_a_backlog(tmp_path: Path, staged: dict[str, str], tickets=("Z34", "Z2")) -> Path:
    """One clean commit, a gitignored backlog holding the given tickets, and the given files staged."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / ".gitignore").write_text("/docs/\n/.leak-patterns.local\n", encoding="utf-8", newline="\n")
    _git(repo, "add", ".gitignore")
    _git(repo, "commit", "-q", "-m", "Start")
    specs = repo / "docs" / "superpowers" / "specs"
    specs.mkdir(parents=True)
    for ticket in tickets:
        (specs / f"{ticket}-a-ticket.md").write_text(f"# {ticket}\n", encoding="utf-8", newline="\n")
    (specs / "2026-01-01-a-design.md").write_text("# A design\n", encoding="utf-8", newline="\n")
    for name, text in staged.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
        _git(repo, "add", name)
    return repo


def test_a_ticket_id_in_staged_code_is_flagged_with_its_file(tmp_path, monkeypatch, capsys):
    repo = _repo_with_a_backlog(tmp_path, {"src/tool.py": "limit = 3  # raised for Z34\n"})
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 1
    assert "staged code: src/tool.py cites ticket Z34" in out
    assert "raised for" not in out, "the scan printed the line it matched"


def test_a_ticket_id_in_a_test_name_is_flagged(tmp_path, monkeypatch, capsys):
    repo = _repo_with_a_backlog(tmp_path, {"tests/test_tool.py": "def test_z2_regression():\n    pass\n"})
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 1
    assert "staged code: tests/test_tool.py cites ticket Z2" in out


def test_only_a_real_ticket_standing_alone_is_a_citation(tmp_path, monkeypatch, capsys):
    clean = "\n".join([
        "paper = 'B5'            # a paper size: there is no ticket B5 in this backlog",
        "colour = '#A34F00'      # inside a longer token",
        "code = 'XA34'           # inside a longer token",
        "version = 'A340'        # a different number",
        "released = '2026-01-01' # a date: a dated design document is not a ticket, and its year is not an ID",
        "",
    ])
    repo = _repo_with_a_backlog(tmp_path, {"src/tool.py": clean})
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 0, out


def test_prose_may_cite_a_ticket_and_a_removed_line_is_not_new(tmp_path, monkeypatch, capsys):
    repo = _repo_with_a_backlog(tmp_path, {"src/tool.py": "limit = 3  # raised for Z34\n"})
    _git(repo, "commit", "-q", "-m", "Add the tool")
    (repo / "src" / "tool.py").write_text("limit = 3  # the smallest batch that still fills a page\n",
                                          encoding="utf-8", newline="\n")
    (repo / "NOTES.md").write_text("The limit was raised by Z34.\n", encoding="utf-8", newline="\n")
    _git(repo, "add", "src/tool.py", "NOTES.md")
    code, out = _scan(repo, monkeypatch, capsys)
    assert "cites ticket" not in out, out


def test_a_commit_message_may_cite_a_ticket(tmp_path, monkeypatch, capsys):
    repo = _repo_with_a_backlog(tmp_path, {"src/tool.py": "limit = 3\n"})
    _git(repo, "commit", "-q", "-m", "Z34: raise the limit")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 0, out


def test_without_a_backlog_on_disk_ticket_ids_are_not_checked_and_it_says_so(tmp_path, monkeypatch, capsys):
    """A clone has no backlog, so it cannot know which words are ticket IDs. It must say that it
    did not look, not report that it looked and found nothing."""
    repo = _repo(tmp_path, "limit = 3  # raised for Z34\n")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 0
    assert "ticket IDs were not checked" in out


def test_a_code_only_pattern_spares_commit_messages(tmp_path, monkeypatch, capsys):
    """A line of the patterns file that starts with `code:` is looked for in staged code only.
    That is where a tool's name goes: a commit may say which tool wrote it, the code may not."""
    repo = _repo_with_a_backlog(tmp_path, {"src/tool.py": "x = 1  # written by widgetbot\n"})
    _write_patterns(repo, "code: \\bwidgetbot\\b\nbluebird\n")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 1
    assert "staged code: src/tool.py matched /\\bwidgetbot\\b/" in out

    _git(repo, "reset", "-q")
    (repo / "src" / "tool.py").write_text("x = 1\n", encoding="utf-8", newline="\n")
    _git(repo, "add", "src/tool.py")
    _git(repo, "commit", "-q", "-m", "Written with widgetbot")
    (repo / "src" / "other.py").write_text("y = 2\n", encoding="utf-8", newline="\n")
    _git(repo, "add", "src/other.py")
    code, out = _scan(repo, monkeypatch, capsys)
    assert code == 0, out


def test_a_code_only_pattern_is_not_an_everywhere_pattern(tmp_path):
    path = tmp_path / PATTERNS_FILE
    path.write_text("# words\nbluebird\ncode: \\bwidgetbot\\b\ncode:   two words  \n", encoding="utf-8", newline="\n")
    assert check_leaks.load_local_patterns(path) == ["bluebird"]
    assert check_leaks.load_code_patterns(path) == ["\\bwidgetbot\\b", "two words"]
    path.write_text("bluebird\ncode: (unclosed\n", encoding="utf-8", newline="\n")
    with pytest.raises(ValueError, match="line 2"):
        check_leaks.load_code_patterns(path)

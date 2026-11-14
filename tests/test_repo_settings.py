"""Tests of scripts/repo_settings.py: the settings that make a public repository findable.

A new repository has no description worth reading, no topics, no homepage, and an empty wiki
that looks abandoned. Projects made from this template shipped releases in that state. The
script sets all four with one command, after the remote exists, and ends by naming the one
thing no command can do.

Nothing here talks to GitHub: every test replaces the one function that runs a command.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import repo_settings  # noqa: E402

DESCRIPTION = "Widget Forge: a free tool that forges one widget at a time"
TOPICS = ["widgets", "command-line", "python3"]
HOMEPAGE = "https://example.com/widget-forge/"


class _Recorder:
    """Stands in for the function that runs a command. Keeps what it was asked to run."""

    def __init__(self, answers: dict[str, str] | None = None):
        self.calls: list[list[str]] = []
        self.answers = answers or {}

    def __call__(self, command: list[str]) -> str:
        self.calls.append(list(command))
        for start, answer in self.answers.items():
            if " ".join(command).startswith(start):
                return answer
        return ""


def _github_holds(description: str = DESCRIPTION, topics: list[str] | None = None,
                  homepage: str = HOMEPAGE, wiki: bool = False) -> str:
    """What `gh repo view --json ...` prints for a repository in the given state."""
    return json.dumps({
        "description": description,
        "hasWikiEnabled": wiki,
        "homepageUrl": homepage,
        "repositoryTopics": [{"name": name} for name in (TOPICS if topics is None else topics)],
    })


def _wire(monkeypatch, origin: str = "git@github.com:octo-dev/widget-forge.git",
          read_back: str | None = None) -> _Recorder:
    recorder = _Recorder({
        "git remote get-url origin": origin,
        "gh repo view": _github_holds() if read_back is None else read_back,
    })
    monkeypatch.setattr(repo_settings, "_run", recorder)
    return recorder


# ---------------------------------------------------------------- the command that will be run


def test_the_plan_is_one_gh_command_with_every_setting():
    assert repo_settings.plan(DESCRIPTION, TOPICS, HOMEPAGE) == [
        "gh", "repo", "edit",
        "--description", DESCRIPTION,
        "--homepage", HOMEPAGE,
        "--enable-wiki=false",
        "--add-topic", "widgets",
        "--add-topic", "command-line",
        "--add-topic", "python3",
    ]


def test_no_homepage_leaves_the_homepage_alone():
    command = repo_settings.plan(DESCRIPTION, TOPICS, "")
    assert "--homepage" not in command
    assert "--enable-wiki=false" in command, "the empty wiki must be turned off either way"


def test_settings_github_would_refuse_are_refused_first():
    """Better to be told here than by a half-applied command."""
    bad = [
        ("", TOPICS, HOMEPAGE),                                # no description
        ("x" * 351, TOPICS, HOMEPAGE),                         # GitHub's limit is 350 characters
        (DESCRIPTION, [], HOMEPAGE),                           # no topic at all
        (DESCRIPTION, ["Widgets"], HOMEPAGE),                  # a topic is lower case
        (DESCRIPTION, ["two words"], HOMEPAGE),                # and has no space
        (DESCRIPTION, ["-leading-hyphen"], HOMEPAGE),          # and starts with a letter or a digit
        (DESCRIPTION, ["t" * 51], HOMEPAGE),                   # and is at most 50 characters
        (DESCRIPTION, [f"topic-{n}" for n in range(21)], HOMEPAGE),   # and there are at most 20
        (DESCRIPTION, ["widgets", "widgets"], HOMEPAGE),       # and none twice
        (DESCRIPTION, TOPICS, "example.com/widget-forge"),     # a homepage is a full address
    ]
    for description, topics, homepage in bad:
        with pytest.raises(SystemExit):
            repo_settings.plan(description, topics, homepage)


# ---------------------------------------------------------------- running it


def _arguments(*extra: str) -> list[str]:
    return ["--description", DESCRIPTION, "--topics", ",".join(TOPICS), "--homepage", HOMEPAGE, *extra]


def test_a_dry_run_prints_the_command_and_runs_nothing_on_github(monkeypatch, capsys):
    recorder = _wire(monkeypatch)
    repo_settings.main(_arguments("--dry-run"))
    out = capsys.readouterr().out
    assert "--add-topic widgets" in out and "--enable-wiki=false" in out
    assert [call for call in recorder.calls if call[0] == "gh"] == [], "a dry run called gh"


def test_a_real_run_applies_the_plan_once_and_reads_the_settings_back(monkeypatch, capsys):
    recorder = _wire(monkeypatch)
    repo_settings.main(_arguments())
    gh_calls = [call for call in recorder.calls if call[0] == "gh"]
    assert gh_calls[0] == repo_settings.plan(DESCRIPTION, TOPICS, HOMEPAGE)
    assert len([call for call in gh_calls if call[:3] == ["gh", "repo", "edit"]]) == 1
    assert gh_calls[-1][:3] == ["gh", "repo", "view"], "the settings were not read back after being set"


def test_it_ends_by_naming_what_no_command_can_do(monkeypatch, capsys):
    _wire(monkeypatch)
    repo_settings.main(_arguments())
    def reminds(out: str) -> bool:
        # What to do, and where: half a reminder sends nobody to the right page.
        text = " ".join(out.lower().split())
        return "upload the social preview image by hand" in text and "settings, then social preview" in text

    assert reminds(capsys.readouterr().out), "no reminder to upload the social preview by hand"
    repo_settings.main(_arguments("--dry-run"))
    assert reminds(capsys.readouterr().out), "a dry run should end the same way"


def test_without_a_remote_nothing_is_set(monkeypatch):
    recorder = _wire(monkeypatch, origin="")
    with pytest.raises(SystemExit):
        repo_settings.main(_arguments())
    assert [call for call in recorder.calls if call[0] == "gh"] == [], "gh was called with no remote to act on"


def test_a_remote_that_is_not_on_github_is_refused(monkeypatch):
    for elsewhere in ("https://example.com/mirror.git",
                      "https://github.com.example.org/octo-dev/widget-forge.git",   # only looks like it
                      "https://notgithub.com/octo-dev/widget-forge.git"):
        recorder = _wire(monkeypatch, origin=elsewhere)
        with pytest.raises(SystemExit):
            repo_settings.main(_arguments())
        assert [call for call in recorder.calls if call[0] == "gh"] == [], elsewhere


def test_every_spelling_of_a_github_remote_is_accepted(monkeypatch):
    for origin in ("https://github.com/octo-dev/widget-forge", "https://github.com/octo-dev/widget-forge.git",
                   "git@github.com:octo-dev/widget-forge.git", "ssh://git@github.com/octo-dev/widget-forge.git"):
        _wire(monkeypatch, origin=origin)
        repo_settings.main(_arguments("--dry-run"))


def test_a_setting_that_did_not_take_is_reported_not_announced(monkeypatch, capsys):
    """`gh` can fail without this script seeing it. So the settings are read back and compared,
    and a run whose settings did not take must not end like one whose settings did."""
    cases = {
        "description": _github_holds(description="An older description"),
        "homepage": _github_holds(homepage="https://example.com/old/"),
        "wiki": _github_holds(wiki=True),
        "python3": _github_holds(topics=["widgets", "command-line"]),
    }
    for word, held in cases.items():
        _wire(monkeypatch, read_back=held)
        with pytest.raises(SystemExit) as caught:
            repo_settings.main(_arguments())
        assert word in str(caught.value), f"the message does not say what did not take: {caught.value}"
        assert "read back" not in capsys.readouterr().out, "it still announced success"


def test_no_answer_from_github_is_a_failure(monkeypatch):
    _wire(monkeypatch, read_back="")
    with pytest.raises(SystemExit) as caught:
        repo_settings.main(_arguments())
    assert "gh auth status" in str(caught.value)

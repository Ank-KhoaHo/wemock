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


def _rule(force: bool = False, deletions: bool = False, admins: bool = True) -> str:
    """What GitHub prints for a branch's rule, in the shape it really has (read on 2026-11-19)."""
    return json.dumps({
        "url": "https://api.github.com/repos/octo-dev/widget-forge/branches/main/protection",
        "allow_force_pushes": {"enabled": force},
        "allow_deletions": {"enabled": deletions},
        "enforce_admins": {"url": "https://api.github.com/x", "enabled": admins},
        "required_linear_history": {"enabled": False},
    })


def _wire(monkeypatch, origin: str = "git@github.com:octo-dev/widget-forge.git",
          read_back: str | None = None, branch: str = "main", rule: str | None = None,
          reporting: str = "true") -> _Recorder:
    """Replace the one function that runs a command. The longer beginnings come first: the
    recorder answers with the first beginning that fits."""
    recorder = _Recorder({
        "git remote get-url origin": origin,
        "gh repo view --json defaultBranchRef": branch,
        "gh repo view": _github_holds() if read_back is None else read_back,
        "gh api -X PUT": "{}",
        "gh api repos/{owner}/{repo}/private-vulnerability-reporting": reporting,
        "gh api repos/{owner}/{repo}/branches/": _rule() if rule is None else rule,
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
    assert gh_calls[1] == repo_settings._READ_BACK, "the settings were not read back right after being set"


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


# ---------------------------------------------------------------- the default branch
#
# A public repository whose default branch has no rule shows GitHub's notice that it is not
# protected, and anyone who can push can rewrite or delete its history. The rule was set by
# hand on three repositories before this script set it.


def test_the_rule_is_one_gh_command():
    assert repo_settings.protection_plan("main") == [
        "gh", "api", "-X", "PUT", "repos/{owner}/{repo}/branches/main/protection",
        "-F", "required_status_checks=null",
        "-F", "enforce_admins=true",
        "-F", "required_pull_request_reviews=null",
        "-F", "restrictions=null",
        "-F", "allow_force_pushes=false",
        "-F", "allow_deletions=false",
    ]


def test_a_name_that_is_not_a_branch_is_refused():
    for name in ("", "main branch", "main;rm", "$(whoami)", "a\nb"):
        with pytest.raises(SystemExit):
            repo_settings.protection_plan(name)
    for name in ("main", "trunk", "release/1.x", "dev_2"):
        assert f"/branches/{name}/protection" in repo_settings.protection_plan(name)[4]


def test_a_real_run_protects_the_default_branch_and_reads_the_rule_back(monkeypatch, capsys):
    recorder = _wire(monkeypatch)
    repo_settings.main(_arguments())
    gh_calls = [call for call in recorder.calls if call[0] == "gh"]
    plan = repo_settings.protection_plan("main")
    assert gh_calls.count(plan) == 1, "the rule was not set exactly once"
    read = ["gh", "api", "repos/{owner}/{repo}/branches/main/protection"]
    assert read in gh_calls and gh_calls.index(read) > gh_calls.index(plan), "the rule was not read back after being set"
    out = capsys.readouterr().out
    assert "main protected (no force push, no deletion)" in out, out


def test_the_default_branch_is_asked_for_never_assumed(monkeypatch, capsys):
    recorder = _wire(monkeypatch, branch="trunk")
    repo_settings.main(_arguments())
    assert repo_settings.protection_plan("trunk") in recorder.calls
    assert repo_settings.protection_plan("main") not in recorder.calls
    assert "trunk protected" in capsys.readouterr().out


def test_a_rule_that_did_not_take_is_reported_not_announced(monkeypatch, capsys):
    cases = {
        "force push": _rule(force=True),
        "deleted": _rule(deletions=True),
        "administrators": _rule(admins=False),
        "not protected": "",                          # gh failed: a private repository on the free plan
        "not protected ": "[]",                       # an answer that is not a rule
    }
    for word, held in cases.items():
        _wire(monkeypatch, rule=held)
        with pytest.raises(SystemExit) as caught:
            repo_settings.main(_arguments())
        assert word.strip() in str(caught.value), f"the message does not say what did not take: {caught.value}"
        assert "read back" not in capsys.readouterr().out, "it still announced success"


def test_a_missing_rule_says_that_a_private_repository_cannot_have_one(monkeypatch):
    assert repo_settings._not_protected("") == [
        "the default branch is not protected: GitHub gave no rule back "
        "(a private repository on the free plan cannot have one)"]
    assert repo_settings._not_protected(_rule()) == []
    assert repo_settings._not_protected(_rule(force=True, deletions=True, admins=False)) == [
        "the default branch still allows a force push",
        "the default branch can still be deleted",
        "the rule does not hold for administrators",
    ]
    assert len(repo_settings._not_protected("{}")) == 3, "a rule with nothing in it protects nothing"


def test_a_default_branch_github_does_not_name_is_a_failure(monkeypatch, capsys):
    for answer in ("", "two words"):
        recorder = _wire(monkeypatch, branch=answer)
        with pytest.raises(SystemExit) as caught:
            repo_settings.main(_arguments())
        assert "default branch could not be read" in str(caught.value)
        assert not [call for call in recorder.calls if "-X" in call and "protection" in " ".join(call)], (
            "a rule was sent for a branch whose name was never read")


def test_every_difference_is_reported_in_one_run(monkeypatch):
    _wire(monkeypatch, read_back=_github_holds(wiki=True), rule=_rule(force=True), reporting="false")
    with pytest.raises(SystemExit) as caught:
        repo_settings.main(_arguments())
    for word in ("wiki", "force push", "vulnerability reporting"):
        assert word in str(caught.value), f"{word!r} is missing from: {caught.value}"


def test_a_dry_run_shows_the_rule_too_and_still_calls_nothing(monkeypatch, capsys):
    recorder = _wire(monkeypatch)
    repo_settings.main(_arguments("--dry-run"))
    out = capsys.readouterr().out
    assert "branches/<default-branch>/protection" in out, out
    assert "allow_force_pushes=false" in out and "allow_deletions=false" in out and "enforce_admins=true" in out
    assert "private-vulnerability-reporting" in out
    assert [call for call in recorder.calls if call[0] == "gh"] == [], "a dry run called gh"


# ---------------------------------------------------------------- where a vulnerability is reported
#
# SECURITY.md sends a reporter to GitHub's private advisory form. That form answers "not found"
# until the repository turns private vulnerability reporting on: one of four repositories had
# it off.


def test_a_real_run_turns_private_reporting_on_and_reads_it_back(monkeypatch):
    recorder = _wire(monkeypatch)
    repo_settings.main(_arguments())
    turn_on = ["gh", "api", "-X", "PUT", "repos/{owner}/{repo}/private-vulnerability-reporting"]
    read = ["gh", "api", "repos/{owner}/{repo}/private-vulnerability-reporting", "--jq", ".enabled"]
    assert recorder.calls.count(turn_on) == 1, "private vulnerability reporting was not turned on exactly once"
    assert read in recorder.calls and recorder.calls.index(read) > recorder.calls.index(turn_on)


def test_reporting_that_stayed_off_is_reported_not_announced(monkeypatch, capsys):
    for answer in ("false", ""):
        _wire(monkeypatch, reporting=answer)
        with pytest.raises(SystemExit) as caught:
            repo_settings.main(_arguments())
        assert "private vulnerability reporting is still off" in str(caught.value), caught.value
        assert "read back" not in capsys.readouterr().out


def test_the_help_holds_no_word_that_reads_as_a_ticket(capsys):
    """An example of a topic was a letter and a digit. A project's leak check lets it pass by
    its lower case alone, and one project changed it to a plain word."""
    import re

    with pytest.raises(SystemExit) as stop:
        repo_settings.main(["--help"])
    assert stop.value.code == 0
    shown = capsys.readouterr().out
    assert "--topics" in shown, "the help was not printed"
    like_a_ticket = re.findall(r"(?<![A-Za-z0-9])[A-Da-d][0-9]{1,3}(?![A-Za-z0-9])", shown)
    assert like_a_ticket == [], f"the help shows {like_a_ticket}, which reads as a ticket"

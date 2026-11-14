"""Tests of the GitHub workflow files: what runs in CI is pinned, and kept up to date.

A workflow runs other people's code with this repository's token. Two rules keep that honest:

* every action is pinned by a full commit hash, with the version it was read from beside it
* Dependabot watches the actions, so a pinned hash does not quietly become years old
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"

_USES_RE = re.compile(r"^\s*(?:-\s*)?uses:\s*(\S+)(.*)$")
_PINNED_RE = re.compile(r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$")
_VERSION_COMMENT_RE = re.compile(r"^\s*#\s*v\d+(\.\d+)*\s*$")


def _uses_lines(text: str) -> list[tuple[int, str, str]]:
    """(line number, what is used, the rest of the line) for every `uses:` line.

    A commented-out one never matches: the pattern allows only spaces and a dash before the key.
    """
    found = []
    for lineno, line in enumerate(text.split("\n"), 1):
        match = _USES_RE.match(line)
        if match:
            found.append((lineno, match.group(1), match.group(2)))
    return found


def _pin_problems(text: str) -> list[str]:
    """What is wrong with how a workflow names its actions, as sentences. Empty when sound."""
    problems = []
    for lineno, used, rest in _uses_lines(text):
        if used.startswith("./") or used.startswith("docker://"):
            continue        # an action in this repository, or an image: nothing of another repo's to pin
        if not _PINNED_RE.match(used):
            problems.append(f"line {lineno}: {used} is not pinned by a full commit hash")
        elif not _VERSION_COMMENT_RE.match(rest):
            problems.append(f"line {lineno}: {used.split('@')[0]} has no version comment beside its hash")
    return problems


def test_a_tag_a_branch_and_a_short_hash_are_not_a_pin():
    workflow = "\n".join([
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-python@main",
        "      - uses: some-org/some-action@11d5960",
        "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
        "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
        "      - uses: some-org/an-action/in-a-folder@33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3",
        "      # - uses: commented/out@v1",
        "      - uses: ./.github/actions/local",
    ])
    problems = _pin_problems(workflow)
    assert [p.split(":")[0] for p in problems] == ["line 2", "line 3", "line 4", "line 5"], problems
    assert "not pinned" in problems[0] and "not pinned" in problems[2]
    assert "no version comment" in problems[3]


def test_every_action_in_every_workflow_is_pinned_by_commit_hash():
    files = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    assert files, "no workflow file was found: the scan is vacuous"
    problems, used = [], 0
    for path in files:
        text = path.read_text(encoding="utf-8")
        used += len(_uses_lines(text))
        problems += [f"{path.name} {problem}" for problem in _pin_problems(text)]
    assert used > 0, "no `uses:` line was read: the scan is vacuous"
    assert problems == [], (
        "a tag can be moved to other code after it was reviewed; a commit hash cannot. "
        + "; ".join(problems)
    )


def test_dependabot_watches_the_actions():
    config = ROOT / ".github" / "dependabot.yml"
    assert config.exists(), "no .github/dependabot.yml: a pinned hash is never updated"
    entries = [line.split(":", 1)[1].strip().strip("\"'")
               for line in config.read_text(encoding="utf-8").splitlines()
               if line.strip().startswith("- package-ecosystem:")]
    assert "github-actions" in entries, (
        f"Dependabot watches {entries} and not the actions the workflows are pinned to"
    )

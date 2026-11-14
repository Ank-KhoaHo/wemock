"""Tests of the GitHub workflow files: what runs in CI is pinned, and kept up to date.

A workflow runs other people's code with this repository's token. Two rules keep that honest:

* every action is pinned by a full commit hash, with the version it was read from beside it
* Dependabot watches the actions, so a pinned hash does not quietly become years old

And the release workflow keeps its shape: it starts from a version tag only, checks before
it builds, takes the tag's name from the environment, and stops at a draft.
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


# ---------------------------------------------------------------- the release workflow
#
# Releases were built and uploaded by hand. release.yml does it from a version tag, and stops
# at a draft: publishing cannot be taken back, so it stays a person's decision.

RELEASE = WORKFLOWS / "release.yml"


def _live(text: str) -> list[str]:
    """The lines of a workflow that are not blank and not a comment."""
    return [line.rstrip() for line in text.split("\n") if line.strip() and not line.strip().startswith("#")]


def _release_lines() -> list[str]:
    assert RELEASE.exists(), "no .github/workflows/release.yml: a release is still built by hand"
    return _live(RELEASE.read_text(encoding="utf-8"))


def _position(lines: list[str], needle: str) -> int:
    found = [index for index, line in enumerate(lines) if needle in line]
    assert len(found) == 1, f"expected one line holding {needle!r}, found {len(found)}"
    return found[0]


def _block(lines: list[str], key: str) -> list[str]:
    """The lines indented under the one line that is exactly `key`, stripped."""
    start = lines.index(key)
    depth = len(key) - len(key.lstrip())
    inner = []
    for line in lines[start + 1:]:
        if len(line) - len(line.lstrip()) <= depth:
            break
        inner.append(line.strip())
    return inner


def test_a_release_starts_from_a_version_tag_and_from_nothing_else():
    trigger = _block(_release_lines(), "on:")
    assert trigger == ["push:", 'tags: ["v[0-9]+.[0-9]+.[0-9]+"]'], (
        f"the release workflow starts from {trigger}: a branch, a pull request or a button "
        "would make a release that no tag names"
    )


def test_the_release_job_is_granted_only_what_it_needs():
    lines = _release_lines()
    assert _block(lines, "permissions:") == ["contents: read"], (
        "the workflow's own permissions are what a job added later starts with: read, and no more"
    )
    granted = dict(re.match(r"([a-z-]+):\s*(\w+)", line).groups() for line in _block(lines, "    permissions:"))
    assert granted == {"contents": "write", "id-token": "write", "attestations": "write"}, granted


def test_a_release_is_checked_then_built_then_attested_then_attached():
    lines = _release_lines()
    order = [_position(lines, needle) for needle in (
        "python scripts/release_notes.py", "python scripts/check.py", "python scripts/build_release.py",
        "actions/attest-build-provenance@", "gh release create")]
    assert order == sorted(order), f"the steps run out of order: {order}"


def test_the_files_attested_are_the_files_attached():
    lines = _release_lines()
    assert "subject-path: dist/*" in [line.strip() for line in lines], "the statement does not name dist/"
    assert " dist/* " in lines[_position(lines, "gh release create")], "the release does not attach dist/"


def test_the_workflow_stops_at_a_draft():
    lines = _release_lines()
    create = lines[_position(lines, "gh release create")]
    for flag in ("--draft", "--verify-tag", "--notes-file"):
        assert flag in create.split(), f"`gh release create` runs without {flag}"
    publishing = [line.strip() for line in lines
                  if "release edit" in line or "--draft=false" in line or "--latest" in line]
    assert publishing == [], f"the workflow publishes by itself: {publishing}"


def test_the_tag_reaches_a_command_only_through_the_environment():
    """A tag is text chosen by whoever pushes it. Written into a command by the workflow, it
    would be run as part of that command."""
    lines = _release_lines()
    commands = [line.strip() for line in lines if line.strip().startswith("run:")]
    assert len(commands) >= 4, "too few commands were read: the scan is vacuous"
    assert [c for c in commands if c in ("run: |", "run: >", "run: |-", "run: >-")] == [], (
        "a command over several lines is not read by this test: keep each on one line"
    )
    assert [c for c in commands if "${{" in c] == [], "an expression is pasted into a command"
    with_tag = [c for c in commands if "GITHUB_REF_NAME" in c]
    assert len(with_tag) == 3, with_tag
    assert all('"$GITHUB_REF_NAME"' in c for c in with_tag), "the tag's name is used without quotes"


def test_the_build_output_is_never_committed():
    import subprocess
    ignored = subprocess.run(["git", "check-ignore", "-q", "--no-index", "dist/anything.zip"],
                             cwd=ROOT, capture_output=True)
    assert ignored.returncode == 0, "dist/ is not covered by .gitignore: a build would be committed"

"""Stop a release whose tag, VERSION file and changelog disagree, and give it its notes.

    python scripts/release_notes.py v1.2.3                 print the notes of that version
    python scripts/release_notes.py v1.2.3 --out FILE      write them to a file instead

.github/workflows/release.yml runs this first, when a version tag is pushed, before anything
is checked or built. Three places say what version this is: the tag, the `VERSION` file, and
the newest block of `CHANGELOG.md`. Each was once typed by hand, and a release in which they
disagree is public the moment it is made. So the release stops here, with every disagreement
named, and not after its files are attached.

THE NOTES COME FROM THE CHANGELOG, so they are written once. The block of that version, as it
stands in `CHANGELOG.md`, is the text of the release. A block with nothing in it stops the
release: the notes are what a user reads.

Exit code 0 when the tag may be released, 1 when it may not.
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# [0-9], not \d: \d also matches digits of other scripts, which no version is written in.
_TAG_RE = re.compile(r"v([0-9]+\.[0-9]+\.[0-9]+)")
_VERSION_RE = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")


def version_of(tag: str) -> str:
    """The version a tag names: `v1.2.3` gives `1.2.3`. Anything else raises ValueError.

    Exactly `v` and three numbers. A suffix, a space, a capital V or a line ending would
    each make a tag that the workflow's own trigger does not start from, or a version the
    changelog cannot be searched for.
    """
    match = _TAG_RE.fullmatch(tag)
    if not match:
        raise ValueError(f"{tag!r} is not a release tag: expected `v` and three numbers, as in v1.2.3")
    return match.group(1)


def _fenced(lines: list[str]) -> list[bool]:
    """For each line, whether it is inside a fenced block, or is one of its two fence lines.

    The changelog shows its own shape in an example, and that example holds a `## 0.1.0`
    heading. A heading inside a fence is an illustration, not a release. Both the search for
    a version's block and the list of released versions read this one answer.
    """
    inside: list[bool] = []
    fence: str | None = None
    for line in lines:
        stripped = line.strip()
        if fence is not None:
            inside.append(True)
            if stripped.startswith(fence):
                fence = None
        elif stripped.startswith("```") or stripped.startswith("~~~"):
            fence = stripped[:3]
            inside.append(True)
        else:
            inside.append(False)
    return inside


def _heading_word(line: str) -> str:
    """The first word of a level-two heading: the version, for a released block. Else ""."""
    if not line.startswith("## "):
        return ""
    words = line[3:].split()
    return words[0] if words else ""


def notes_for(changelog: str, version: str) -> str | None:
    """The changelog block of `version`, without the blank lines around it.

    "" when the block is there and holds nothing; None when there is no block for that
    version. The block ends at the next level-two heading. A fenced example inside the
    block belongs to it; a heading inside any fence starts nothing and ends nothing.
    """
    lines = changelog.splitlines()
    fenced = _fenced(lines)
    block: list[str] | None = None
    for line, in_fence in zip(lines, fenced):
        if not in_fence and line.startswith("## "):
            if block is not None:
                break
            if _heading_word(line) == version:
                block = []
            continue
        if block is not None:
            block.append(line)
    if block is None:
        return None
    while block and not block[0].strip():
        block.pop(0)
    while block and not block[-1].strip():
        block.pop()
    return "\n".join(block)


def _version_numbers(version: str) -> tuple[int, ...]:
    """A version as numbers, so that 1.10.0 is newer than 1.9.0."""
    return tuple(int(part) for part in version.split("."))


def _released_versions(changelog: str) -> list[str]:
    """Every version that has a block in the changelog, in the order written."""
    lines = changelog.splitlines()
    return [word for line, in_fence in zip(lines, _fenced(lines))
            if not in_fence and _VERSION_RE.fullmatch(word := _heading_word(line))]


def problems(tag: str, version_file: str, changelog: str) -> list[str]:
    """Return every reason this tag must not be released, or an empty list if valid.

    Checks tag formatting, agreement with the VERSION file, existence and non-emptiness
    of notes in CHANGELOG.md, and ensures no newer version is already recorded in the changelog.
    """
    try:
        tag_version = version_of(tag)
    except ValueError as err:
        return [str(err)]

    reasons: list[str] = []

    v_stripped = version_file.strip()
    if v_stripped != tag_version:
        reasons.append(
            f"VERSION file specifies {v_stripped}, but tag version is {tag_version}."
        )

    notes = notes_for(changelog, tag_version)
    if notes is None:
        reasons.append(f"CHANGELOG.md has no block for version {tag_version}.")
    elif notes == "":
        reasons.append(
            f"Release notes for version {tag_version} are empty; the notes are what a user reads."
        )

    tag_tuple = _version_numbers(tag_version)
    newer = [
        v for v in _released_versions(changelog)
        if _version_numbers(v) > tag_tuple
    ]
    if newer:
        newest = max(newer, key=_version_numbers)
        reasons.append(
            f"CHANGELOG.md holds a released version {newest} that is newer than tag {tag_version}."
        )

    return reasons


def _say(text: str) -> None:
    """Print, whatever the screen can display.

    Notes are a person's prose, and hold dashes and accents. A Windows console often cannot
    encode them, and `print` then raises: the command would fail on a release that is sound.
    A character the screen cannot show costs one "?" on screen, and nothing else. A file
    written with --out is always UTF-8 and is not affected.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(text.encode(encoding, errors="replace").decode(encoding))


def main(argv: list[str] | None = None) -> int:
    """The command: every problem on its own line and exit code 1, or the notes and 0.

    Nothing is written when there is a problem: notes on disk for a release that was
    refused would be picked up by whatever runs next.
    """
    parser = argparse.ArgumentParser(
        description="Verify tag consistency and output release notes."
    )
    parser.add_argument("tag", help="Release tag to inspect (e.g. v1.2.3)")
    parser.add_argument(
        "--out",
        help="Path to write the release notes to instead of printing to standard output",
    )
    args = parser.parse_args(argv)

    missing: list[str] = []
    version_path = ROOT / "VERSION"
    changelog_path = ROOT / "CHANGELOG.md"

    if not version_path.is_file():
        missing.append(f"VERSION file is missing: {version_path}")
    if not changelog_path.is_file():
        missing.append(f"CHANGELOG.md file is missing: {changelog_path}")

    if missing:
        for problem in missing:
            _say(problem)
        return 1

    version_text = version_path.read_text(encoding="utf-8")
    changelog_text = changelog_path.read_text(encoding="utf-8")

    all_problems = problems(args.tag, version_text, changelog_text)
    if all_problems:
        for problem in all_problems:
            _say(problem)
        return 1

    notes = notes_for(changelog_text, version_of(args.tag))
    assert notes is not None

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(notes + "\n", encoding="utf-8", newline="\n")
    else:
        _say(notes)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

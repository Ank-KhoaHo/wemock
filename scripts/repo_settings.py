"""Set the settings that make a public repository findable, with one command.

    python scripts/repo_settings.py --description "..." --topics a,b,c --homepage https://... --dry-run
    python scripts/repo_settings.py --description "..." --topics a,b,c --homepage https://...

A new repository has a description nobody chose, no topics, no homepage, and an empty wiki
that looks abandoned. Search, and every link card, read exactly those. This sets all four, then
reads them back to check they took.

IT CHANGES WHAT THE PUBLIC SEES. So the maintainer runs it, on purpose, once the remote exists;
nothing else in this repository runs it. Use --dry-run first: it prints the command and
changes nothing.

ONE THING NO COMMAND CAN DO: the social preview image. GitHub has no API for it, so the script
ends by saying where to upload it by hand.
"""

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_GITHUB_REMOTE_RE = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)[\w.-]+/[\w.-]+?(?:\.git)?/?$")
_TOPIC_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_READ_BACK = ["gh", "repo", "view", "--json", "description,homepageUrl,repositoryTopics,hasWikiEnabled"]


def _run(command: list[str]) -> str:
    """Run one command from the repository root; return its output, or "" if it failed.

    EVERY command this script runs goes through here, so a test can replace this one function
    and be sure nothing reaches GitHub. Because a failure comes back as "", main() never takes
    the edit's word for it: it reads the settings back and compares.
    """
    try:
        done = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                              encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return (done.stdout or "").strip() if done.returncode == 0 else ""


def plan(description: str, topics: list[str], homepage: str) -> list[str]:
    """The one `gh` command that sets everything, as a list of arguments.

    Anything GitHub would refuse is refused here first, with a message that names it: better
    than a command that applied half of what was asked.
    """
    if not description:
        raise SystemExit("repo_settings: the description is empty.")
    if len(description) > 350:
        raise SystemExit(f"repo_settings: the description has {len(description)} characters; GitHub allows 350.")
    if not topics:
        raise SystemExit("repo_settings: give at least one topic.")
    if len(topics) > 20:
        raise SystemExit(f"repo_settings: {len(topics)} topics; GitHub allows 20.")
    if len(set(topics)) != len(topics):
        raise SystemExit("repo_settings: a topic is given twice.")
    for topic in topics:
        if len(topic) > 50 or not _TOPIC_RE.match(topic):
            raise SystemExit(f"repo_settings: {topic!r} is not a topic GitHub accepts: lower-case letters, "
                             f"digits and hyphens, starting with a letter or a digit, at most 50 characters.")
    if homepage and not homepage.startswith(("http://", "https://")):
        raise SystemExit(f"repo_settings: the homepage {homepage!r} is not a full address.")

    command = ["gh", "repo", "edit", "--description", description]
    if homepage:
        command += ["--homepage", homepage]
    command.append("--enable-wiki=false")
    for topic in topics:
        command += ["--add-topic", topic]
    return command


def _not_applied(read_back: str, description: str, topics: list[str], homepage: str) -> list[str]:
    """What GitHub holds that differs from what was asked, as sentences. Empty when all took."""
    try:
        held = json.loads(read_back)
    except ValueError:
        return ["GitHub's answer could not be read. Is `gh` signed in? Try: gh auth status"]
    differences = []
    if held.get("description") != description:
        differences.append("the description is not the one given")
    if homepage and (held.get("homepageUrl") or "").rstrip("/") != homepage.rstrip("/"):
        differences.append("the homepage is not the one given")
    if held.get("hasWikiEnabled") is not False:
        differences.append("the wiki is still on")
    names = {entry.get("name") for entry in (held.get("repositoryTopics") or [])}
    missing = [topic for topic in topics if topic not in names]
    if missing:
        differences.append(f"these topics are missing: {', '.join(missing)}")
    return differences


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Set a public repository's description, topics, "
                                                 "homepage and wiki.")
    parser.add_argument("--description", required=True, help="one line; start it with the product's name")
    parser.add_argument("--topics", required=True, help="comma-separated, lower case, for example api-mock,devtools")
    parser.add_argument("--homepage", default="", help="a full address; leave out to keep the current one")
    parser.add_argument("--dry-run", action="store_true", help="print the command and change nothing")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    origin = _run(["git", "remote", "get-url", "origin"])
    if not _GITHUB_REMOTE_RE.match(origin):
        raise SystemExit(f"repo_settings: `origin` is {origin or 'not set'}. Create the repository on "
                         f"GitHub and point `origin` at it first; nothing was changed.")

    topics = [topic.strip() for topic in args.topics.split(",")]
    command = plan(args.description, topics, args.homepage)

    if args.dry_run:
        print("Dry run. This would run:")
        print("  " + shlex.join(command))
    else:
        _run(command)
        differences = _not_applied(_run(_READ_BACK), args.description, topics, args.homepage)
        if differences:
            raise SystemExit("repo_settings: the settings did not all take: " + "; ".join(differences) + ".")
        print("Set, and read back from GitHub: the description, the homepage, the topics, the wiki off.")

    print("\nOne thing is left, and no command can do it: upload the social preview image by hand")
    print("(the repository's Settings, then Social preview). GitHub has no API for it.")


if __name__ == "__main__":
    main()

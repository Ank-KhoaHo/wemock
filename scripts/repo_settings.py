"""Set the settings that make a public repository findable, with one command.

    python scripts/repo_settings.py --description "..." --topics a,b,c --homepage https://... --dry-run
    python scripts/repo_settings.py --description "..." --topics a,b,c --homepage https://...

A new repository has a description nobody chose, no topics, no homepage, and an empty wiki
that looks abandoned. Search, and every link card, read exactly those. This sets all four,
protects the default branch (no force push, no deletion, administrators included, and nothing
that stops a direct push), and turns private vulnerability reporting on, because SECURITY.md
sends a reporter to that form. It reads them all back to check they took. A private repository
on GitHub's free plan cannot have the branch rule, and the script then says so and fails.

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
_BRANCH_RE = re.compile(r"^[\w./-]+$")
_DEFAULT_BRANCH = ["gh", "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]
_READ_BACK = ["gh", "repo", "view", "--json", "description,homepageUrl,repositoryTopics,hasWikiEnabled"]
_REPORTING_ON = ["gh", "api", "-X", "PUT", "repos/{owner}/{repo}/private-vulnerability-reporting"]
_REPORTING_READ_BACK = ["gh", "api", "repos/{owner}/{repo}/private-vulnerability-reporting", "--jq", ".enabled"]


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


def protection_plan(branch: str, check_name: bool = True) -> list[str]:
    """The one `gh` command that sets branch protection on the default branch.

    The rule allows no force push and no deletion, for administrators too.
    It requires no status checks and no pull request reviews, so a direct push still works.
    """
    if check_name and not _BRANCH_RE.match(branch):
        raise SystemExit(f"repo_settings: {branch!r} is not a branch name.")
    return [
        "gh", "api", "-X", "PUT", f"repos/{{owner}}/{{repo}}/branches/{branch}/protection",
        "-F", "required_status_checks=null",
        "-F", "enforce_admins=true",
        "-F", "required_pull_request_reviews=null",
        "-F", "restrictions=null",
        "-F", "allow_force_pushes=false",
        "-F", "allow_deletions=false",
    ]


def _protection_read_back(branch: str) -> list[str]:
    """The `gh` command that reads back the branch protection settings."""
    return ["gh", "api", f"repos/{{owner}}/{{repo}}/branches/{branch}/protection"]


def _not_protected(read_back: str) -> list[str]:
    """What GitHub holds that differs from the branch protection rule, as sentences."""
    try:
        held = json.loads(read_back)
    except ValueError:
        return [
            "the default branch is not protected: GitHub gave no rule back "
            "(a private repository on the free plan cannot have one)"
        ]
    if not isinstance(held, dict):
        return [
            "the default branch is not protected: GitHub gave no rule back "
            "(a private repository on the free plan cannot have one)"
        ]

    differences = []
    force_pushes = held.get("allow_force_pushes")
    if not (isinstance(force_pushes, dict) and force_pushes.get("enabled") is False):
        differences.append("the default branch still allows a force push")
    deletions = held.get("allow_deletions")
    if not (isinstance(deletions, dict) and deletions.get("enabled") is False):
        differences.append("the default branch can still be deleted")
    admins = held.get("enforce_admins")
    if not (isinstance(admins, dict) and admins.get("enabled") is True):
        differences.append("the rule does not hold for administrators")
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
        print("  " + shlex.join(protection_plan("<default-branch>", check_name=False)))
        print("  " + shlex.join(_REPORTING_ON))
    else:
        _run(command)
        differences = _not_applied(_run(_READ_BACK), args.description, topics, args.homepage)

        branch = _run(_DEFAULT_BRANCH)
        if not branch or not _BRANCH_RE.match(branch):
            differences.append("the default branch could not be read, so it is not protected")
        else:
            _run(protection_plan(branch))
            differences.extend(_not_protected(_run(_protection_read_back(branch))))

        _run(_REPORTING_ON)
        if _run(_REPORTING_READ_BACK).strip() != "true":
            differences.append("private vulnerability reporting is still off: SECURITY.md sends a reporter to that form")

        if differences:
            raise SystemExit("repo_settings: the settings did not all take: " + "; ".join(differences) + ".")
        print(f"Set, and read back from GitHub: the description, the homepage, the topics, the wiki off, "
              f"{branch} protected (no force push, no deletion), and private vulnerability reporting on.")

    print("\nOne thing is left, and no command can do it: upload the social preview image by hand")
    print("(the repository's Settings, then Social preview). GitHub has no API for it.")


if __name__ == "__main__":
    main()

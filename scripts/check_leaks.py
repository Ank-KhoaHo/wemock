"""Scan the four places working material leaks into a public repository.

Run before a PUSH, not before a merge: that is the difference between an edit
and a permanent record.

The surfaces, and why two of them get missed:

1. Tracked files -- the obvious one.
2. COMMIT SUBJECTS AND BODIES. As public as the file, permanently, and a
   subject summarising what you just hid is the same leak somewhere nobody
   reviews for it.
3. THE .gitignore ITSELF. A rule that hides a file is published. A comment
   inventorying what that file contains tells a reader exactly what was
   withheld.
4. STAGED CODE, file by file. A ticket ID in public code points at a backlog
   nobody outside can open, and the name of the tool that wrote a line
   explains nothing about the line. A commit message may cite a ticket; code
   may not. Ticket IDs are known only where the backlog is on disk, so a
   clone says that it did not look rather than that it found nothing.

PATTERNS ships nearly empty on purpose. The nouns worth catching are the ones
only this project knows -- an internal codename, a private sibling repo, a
customer. Put them in .leak-patterns.local (one regular expression per line;
a line that starts with `code:` is looked for in staged code only).
Until you do, this script is a credential scanner rather than a leak scanner.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# This project's own nouns live in a GITIGNORED file, never in this one: this
# script is tracked in a public repository, so a list of private names written
# here would publish exactly what it exists to keep out. One regular expression
# per line; blank lines and lines starting with `#` are skipped. Each line stays
# its own pattern, so a finding names the one noun that matched.
# A line that starts with `code:` is a pattern for staged code only: the name of
# a tool that writes code belongs there, because a commit message may say which
# tool wrote a change, and the code may not.
LOCAL_PATTERNS_FILE = ROOT / ".leak-patterns.local"

# Generic, ship-with defaults: the shapes of a credential. Nothing project-specific
# belongs in this list -- see LOCAL_PATTERNS_FILE above.
PATTERNS = [
    # Shape: a credential noun glued to a value being handed over -- a colon
    # or equals followed by something non-empty, or a quoted string right
    # after the noun ("password: hunter2", "api_key = \"sk-...\"", "secret
    # \"x\""). Prose that mentions the word without a value stapled to it --
    # "the secret is safe", a bare "password" -- is talk ABOUT credentials,
    # not one being leaked, and must not match.
    r"\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|bearer)\b"
    r"\s*(?:[:=]\s*\S+|[\"'][^\"']+[\"'])",
    # Shape: a path that names where a credential lives, rather than a value
    # being handed over -- "secrets/deploy_key.pem", "credentials/prod.json".
    # The pattern above never sees these: there is no `:`/`=`/quote for it to
    # anchor on, and the plural "secrets" defeats \bsecret\b's word boundary
    # outright (no boundary exists between the "t" and the "s"). This one
    # matches on the path shape instead, so plural or singular both catch.
    # The character after the slash must start a filename ([\w], not \S): a
    # bare `\S` also matches a closing backtick or a hyphen, which is exactly
    # what a sentence discussing this shape in markdown looks like --
    # "`secrets/`-style paths" closes its code span right at the slash, and a
    # `\S+` version of this pattern flagged that discussion as a leak the
    # first time it was written down, in this project's own design doc.
    r"\b(?:secrets?|credentials?)[/\\]\w[\w.\-]*",
    # Shape: an OpenAI-style secret key literal.
    r"\bsk-[A-Za-z0-9]{16,}\b",
    # Shape: a GitHub personal access token literal.
    r"\bghp_[A-Za-z0-9]{20,}\b",
    # Shape: a PEM private key header.
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
]

# The nouns a count or an inventory verb can govern. Kept as one list, reused
# by both patterns below: a count and a verb are two different ways of
# announcing the same inventory, and a noun worth catching under one is worth
# catching under the other. "design notes" and "decision records" are two
# words, not one -- named explicitly rather than papered over with `\w+`
# between the count and the noun, which would also swallow an adjective in
# ordinary prose ("8 open tickets" is discussed, not fixed, in the design doc).
_INVENTORY_NOUNS = (
    r"credentials?|secrets?|passwords?|keys?|tokens?|tickets?|rows?|specs?|"
    r"notes?|design\s+notes|decision\s+records|customers?|names?|emails?|"
    r"addresses?|paths?|codenames?|files?|entries|records?|items?|data"
)

# An inventory of withheld material -- a .gitignore comment must justify a rule,
# never describe what it hides, and the same is true of a mirror document like
# PUBLIC.md, which is staged like any other file and caught by the same scan of
# the staged diff below. The name is kept even though it now covers more than
# .gitignore: it names the SHAPE of the leak, not the one surface it was first
# written against.
GITIGNORE_INVENTORY = [
    # Shape: an explicit count of content items -- "47 tickets", "9 design
    # notes". `\d+`, not `\d{2,}`: a single-digit count is still a count, and
    # limiting this to two-or-more digits is precisely what let "8 open
    # tickets" -- discussed below, not fixed -- read as clean.
    rf"\b\d+\s+(?:{_INVENTORY_NOUNS})\b",
    # Shape: an inventory VERB caught in the act, directly governing a
    # content NOUN -- "contains the design notes", "holds 12 tickets",
    # "lists the customers". The verb alone doesn't earn a match: prose
    # that uses "contains" or "inventory" to talk ABOUT the rule ("a comment
    # that inventories what a hidden file CONTAINS tells a reader exactly")
    # has no content noun sitting right after it, only more prose.
    rf"\b(?:contains|holds|lists|inventories)\b\s+(?:\d+\s+)?"
    rf"(?:the\s+|a\s+|an\s+|all\s+|these\s+|our\s+)?(?:{_INVENTORY_NOUNS})\b",
]

# KNOWN GAPS, left open rather than papered over with a pattern broad enough to
# start matching ordinary prose (a scanner that cries wolf on a clean repo is
# worse than none -- this one already was, once, before F3):
#   - a count separated from its noun by an adjective ("8 open tickets") --
#     closing it needs an unbounded word-gap, which would also swallow
#     unrelated sentences that happen to have a number and a listed noun
#     several words apart;
#   - a count sized with a noun outside _INVENTORY_NOUNS ("180 lines") --
#     "lines" alone is far too common in ordinary prose (line counts, poems,
#     code) to add without a flood of false positives;
#   - an inventory verb outside {contains, holds, lists, inventories}
#     ("carries the rest") -- English has no closed set of these;
#   - a sibling repo's actual name or an internal codename -- inherently
#     project-specific, never genericizable, and exactly what
#     .leak-patterns.local exists to hold for THIS project.
# See design doc S6 for which parts of the worked example this leaves uncaught.


def _run(*args: str) -> str:
    # encoding="utf-8" is required, not cosmetic: text=True with no encoding=
    # falls back to the locale codec (cp1252 on this maintainer's Windows), and
    # template/seed/CLAUDE.md's own headings open with U+26A0 U+FE0F -- the
    # trailing byte of that pair is undefined in cp1252, so decoding raises
    # UnicodeDecodeError the moment that shipped file is staged. errors="replace"
    # keeps a genuinely undecodable byte from crashing the scan outright; losing
    # one character's fidelity in a diff we only regex against costs nothing.
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    # `or ""` only bites on a non-zero exit, and a git failure means the scan
    # read NOTHING from that surface -- returning "" here made that read as
    # clean, the same silent-success shape this whole script exists to catch
    # elsewhere. It is surfaced by the caller instead of swallowed here.
    if r.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {r.returncode}): {r.stderr.strip()}"
        )
    return r.stdout or ""


def _hits(text: str, patterns: list[str], label: str) -> list[str]:
    out = []
    for line in text.split("\n"):
        for pat in patterns:
            if re.search(pat, line, re.I):
                # Print the PATTERN that matched and where -- never the matching
                # line. A leak scanner that echoes the leak into a build log has
                # moved it, not caught it.
                out.append(f"{label}: matched /{pat}/")
                break
    return out


def load_local_patterns(path: Path) -> list[str]:
    """Load private regex patterns from a file, one per line.

    Strip each line; skip blank lines and lines that start with '#'.
    A missing file gives [].
    A line that does not compile raises ValueError naming the file and line N.
    """
    if not path.is_file():
        return []
    patterns = []
    text = path.read_text(encoding="utf-8")
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        # Lines starting with `code:` are code-only patterns and must not be
        # loaded here as everywhere patterns, so they spare commit messages.
        if not line or line.startswith("#") or line.startswith("code:"):
            continue
        try:
            re.compile(line)
        except re.error as exc:
            raise ValueError(f"{path.name} line {lineno}: invalid regular expression {line!r}: {exc}") from exc
        patterns.append(line)
    return patterns


def load_code_patterns(path: Path) -> list[str]:
    """Load code-only private regex patterns from a file, in file order.

    A line starting with 'code:' is a pattern for staged code only.
    The pattern is what follows 'code:', stripped.
    A missing file gives [].
    A pattern that does not compile raises ValueError naming the file and line N.
    """
    if not path.is_file():
        return []
    patterns = []
    text = path.read_text(encoding="utf-8")
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        # Only lines prefixed with `code:` apply to staged code; other lines are
        # everywhere patterns handled by load_local_patterns.
        if not line.startswith("code:"):
            continue
        pat = line[len("code:"):].strip()
        try:
            re.compile(pat)
        except re.error as exc:
            raise ValueError(f"{path.name} line {lineno}: invalid regular expression {pat!r}: {exc}") from exc
        patterns.append(pat)
    return patterns


# Prose and data extensions: prose and data may cite tickets, so only files
# whose extension is NOT in this set count as code.
NON_CODE_EXTENSIONS = {
    ".md",
    ".html",
    ".json",
    ".csv",
    ".tsv",
    ".txt",
    ".svg",
    ".lock",
}


def _is_code_file(path_str: str) -> bool:
    """Return True if path_str is a code file that should be scanned.

    'Code' is every file whose extension is not one of .md, .html, .json,
    .csv, .tsv, .txt, .svg, .lock.
    scripts/check_leaks.py itself stays excluded from the scan.
    """
    p = Path(path_str)
    # scripts/check_leaks.py is excluded here just as it is from the staged diff
    # scan, so its own implementation does not trip the rules it enforces.
    if p.as_posix() == "scripts/check_leaks.py":
        return False
    return p.suffix.lower() not in NON_CODE_EXTENSIONS


def load_ticket_ids(specs_dir: Path) -> list[str]:
    """Load ticket IDs from ticket spec files in specs_dir.

    The ticket IDs of this project are the names of its ticket specs:
    every *.md file whose name does not start with a year (2026-...).
    The ID is the part of the file name before the first '-' that follows it.
    """
    # If the specs directory does not exist, ticket IDs cannot be known.
    if not specs_dir.is_dir():
        return []
    ticket_ids = []
    for path in sorted(specs_dir.glob("*.md")):
        # Design specs start with a 4-digit year and are not tickets.
        if re.match(r"^\d{4}-", path.name):
            continue
        # The ticket ID is the token before the first hyphen, e.g. A34 from A34-a-ticket.md.
        ticket_id = path.name.split("-")[0]
        if ticket_id and ticket_id not in ticket_ids:
            ticket_ids.append(ticket_id)
    return ticket_ids


def _scan_staged_code(
    diff_text: str,
    ticket_ids: list[str],
    code_patterns: list[str],
) -> list[str]:
    """Scan added lines in staged code files for ticket IDs and code patterns.

    A diff names the file in a `+++ b/<path>` line; an added line starts with
    `+` and is not that header. A removed line is not new, and is never judged.
    """
    # Ticket IDs must stand alone: preceded and followed by a non-alphanumeric character.
    # An underscore counts as a separator, so \b cannot be used as it treats _ as a word char.
    ticket_regexes = [
        (tid, re.compile(rf"(?<![a-zA-Z0-9]){re.escape(tid)}(?![a-zA-Z0-9])", re.I))
        for tid in ticket_ids
    ]
    code_regexes = [
        (pat, re.compile(pat, re.I))
        for pat in code_patterns
    ]

    findings = []
    current_file = None
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[6:]
        elif line.startswith("+++ /dev/null"):
            current_file = None
        elif line.startswith("+"):
            # Only new lines in code files are scanned; removed lines and prose/data files are spared.
            if not current_file or not _is_code_file(current_file):
                continue
            line_content = line[1:]
            for tid, rx in ticket_regexes:
                if rx.search(line_content):
                    # Never print the line that matched, only the file and the cited ticket ID.
                    findings.append(f"staged code: {current_file} cites ticket {tid}")
            for pat, rx in code_regexes:
                if rx.search(line_content):
                    # Flag code-only pattern matches without leaking the matching line content.
                    findings.append(f"staged code: {current_file} matched /{pat}/")
                    break
    return findings


def main() -> int:
    # Loaded before anything is scanned. A pattern that cannot compile stops the
    # scan with its own exit code: skipped quietly, it would match nothing, and
    # the scan would read as clean with the project's own words never looked for.
    try:
        local_patterns = load_local_patterns(LOCAL_PATTERNS_FILE)
        code_patterns = load_code_patterns(LOCAL_PATTERNS_FILE)
    except ValueError as exc:
        print(f"check_leaks: {exc} -- fix it before pushing; nothing was scanned")
        return 2

    # Ticket IDs are discovered dynamically from ROOT so clones or test runners
    # with custom roots are inspected correctly.
    specs_dir = ROOT / "docs" / "superpowers" / "specs"
    specs_missing = not specs_dir.is_dir()
    ticket_ids = load_ticket_ids(specs_dir)

    findings = []
    active = PATTERNS + local_patterns + GITIGNORE_INVENTORY
    # scripts/check_leaks.py is excluded from its own scan on purpose:
    # PATTERNS above has to spell out the literal words it hunts for
    # (password, secret, sk-..., ghp_..., BEGIN PRIVATE KEY), so staging an
    # edit to this file always "matches itself" -- the credential-scanner
    # equivalent of an antivirus flagging its own signature file. Keyed on
    # path, not content, so a real leak added anywhere else in the same
    # commit still trips this.
    # PATTERNS + GITIGNORE_INVENTORY, not PATTERNS alone: PUBLIC.md is a
    # tracked file, so an inventory pasted into it arrives here as ordinary
    # staged diff content, and PATTERNS' credential shapes match none of it --
    # only the inventory shapes do. Before this the staged diff was scanned
    # for credentials only, so the mirror document -- the highest-risk leak
    # surface -- had no coverage here at all despite three documents saying
    # it did.
    staged_diff = _run("git", "diff", "--cached", "--", ".", ":(exclude)scripts/check_leaks.py")
    findings += _hits(staged_diff, active, "staged diff")
    # PATTERNS + local_patterns + GITIGNORE_INVENTORY here too, not PATTERNS alone: this scan's own
    # module docstring defines surface 2 as "a subject summarising what you just
    # hid" -- an inventory shape ("hide docs/, which holds 42 tickets and the
    # internal design notes"), not a credential shape. A credential is not
    # usually the thing named in a commit subject; an inventory of what got
    # hidden is exactly the thing a maintainer writes there without thinking.
    # Before this, that shape was caught in .gitignore and in the staged diff
    # but sailed straight through the one surface that is a subject LINE by
    # definition.
    findings += _hits(_run("git", "log", "--branches", "--not", "--remotes",
                           "--format=%s%n%b"),
                      active, "unpushed commit message")
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    findings += _hits(gitignore, active, ".gitignore")

    # Surface 4: staged code, file by file. Citing ticket IDs or tool names is
    # refused in code because outside readers cannot open internal backlogs and
    # tool names explain nothing about the code.
    findings += _scan_staged_code(staged_diff, ticket_ids, code_patterns)

    if specs_missing:
        # Said on every run, clean or not: in a clone the backlog is absent, so no word can
        # be known to be a ticket ID, and silence would read as "looked, found none".
        print("check_leaks: ticket IDs were not checked: there is no backlog on this disk "
              "(docs/superpowers/specs), so no word can be known to be one.")
    if findings:
        print("POSSIBLE LEAK -- do not push until each is explained:")
        for f in dict.fromkeys(findings):
            print("  " + f)
        return 1
    print("check_leaks: staged diff, unpushed commit messages and .gitignore are clean")
    if local_patterns:
        print(f"  (generic credential shapes, and {len(local_patterns)} of this project's own "
              f"from {LOCAL_PATTERNS_FILE.name})")
    else:
        print(f"  (generic credential shapes ONLY: no {LOCAL_PATTERNS_FILE.name} here, so this "
              f"project's own private words were not looked for)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

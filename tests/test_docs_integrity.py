"""Proves the documentation in this repo is internally consistent -- in
whichever of its two states the running tree is actually in.

This repository ships two states of the same tree, not one. On the
maintainer's own disk, docs/superpowers/specs/ and BACKLOG.html exist,
gitignored, holding a working backlog. Everywhere else -- CI, and anyone who
clones this repo -- that half is simply absent, because it was never
tracked. A guard written for only one of those two states goes silently
vacuous in the other. So every assertion below runs in both, and asserts
something TRUE in each: what a stale index would look like when it CAN be
built, and what a leak would look like when it CANNOT.

_local_mode() decides which of the two applies, read from the disk itself,
never from a CI environment variable someone could set wrong.

Three things carried over unchanged from the assertions this file is built
on, because they are still exactly the right shape here:

* The walk uses `git ls-files --cached --others --exclude-standard`, not a
  filesystem crawl and not plain `ls-files`. A crawl needs a fragile
  exclusion list; plain `ls-files` cannot see a file that exists on disk but
  is not yet staged, so the guard would report green on precisely the change
  being made. Git failing is a test FAILURE, not a skip.
* Every loop asserts it actually scanned something. A resolver that checks
  zero links reports green having verified nothing.
* A file the walk found but cannot read is a failure, not a skip.

THE ESCAPE HATCH, named rather than left to be discovered later:
_deliberately_unpublished() lets the link check tolerate a target git says
is ignored. In this repo most such targets ARE ignored, so a version of that
helper which always answered yes would make the link check pass having
verified nothing -- in both modes at once, while reporting success. That is
why the tolerated count is printed and counted rather than silently waved
through, and why the LOCAL link floor is set high enough that a hatch this
wide has somewhere to be caught.
"""

import posixpath
import re
import subprocess
import sys
from pathlib import Path

import pytest


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _scannable(*globs: str) -> list[str]:
    """Files matching the globs that a guard must see before they are committed.

    Returns both tracked files and untracked files (unless gitignored), repo-relative,
    POSIX separators. A file about to be committed is a file the guard must already
    be able to see: a guard that only sees committed files reports green on precisely
    the change a person is about to make. Untracked-but-not-ignored files are included
    because .gitignore exclusions (like .venv/, out/, data/) are honored and should
    stay excluded.

    A git failure raises rather than returning an empty list: an empty walk
    would make every assertion below vacuously true.
    """
    # encoding= and errors= are load-bearing, not cosmetic -- see check_leaks.py's
    # _run() for the full story. `-z` hands back raw pathname bytes; text=True with
    # no codec falls back to the locale's (cp1252 on this maintainer's Windows),
    # which raises mid-decode the moment a non-ASCII FILENAME is scanned. Note
    # `-z` emits pathnames only, never contents, so the trigger is a file someone
    # names with an emoji or an accent -- not this repo's own emoji headings, which
    # this call never sees. No tracked path is non-ASCII today, so the case is
    # unexercised rather than already proven. Left unhandled it surfaces as .stdout
    # being None, so `or ""` guards the split() below rather than letting a NoneType
    # crash stand in for the real error.
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", *globs],
        cwd=_repo_root(), capture_output=True, check=True, text=True,
        encoding="utf-8", errors="replace",
    ).stdout or ""
    return [p for p in out.split("\0") if p]


def _read(rel: str) -> str:
    """Read a tracked file. Unreadable is a failure, not a skip."""
    path = _repo_root() / rel
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:  # pragma: no cover - the assertion is the point
        pytest.fail(
            f"{rel} is tracked but could not be read ({exc}) — a read failure "
            f"must fail the scan, not be silently skipped"
        )


_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_FENCE_RE = re.compile(r"^\s*(?:```|~~~)")


def _iter_markdown_links(text: str):
    """Yield (line_number, target) for every link OUTSIDE a fenced code block.

    Fences are skipped deliberately: a design document that illustrates a
    file's shape with a fenced example routinely links to something that does
    not exist yet, and such a link is an illustration, not a claim -- it is not
    clickable anywhere.

    THE HOLE THIS LEAVES, named rather than discovered later: a genuinely stale
    link inside a fence goes unchecked. The regex is also blind to
    reference-style links `[text][ref]`, angle-bracket targets, single-quoted
    titles, and untitled targets containing a space; those produce zero matches
    rather than a false pass, so they undercount rather than lie. Ticket D2
    carries the decision about whether any of this matters here.
    """
    in_fence = False
    for lineno, line in enumerate(text.split("\n"), 1):
        if _FENCE_RE.match(line):
            # Assumes fence markers are balanced; an unbalanced count silently
            # stops scanning the rest of the file without raising (guarded
            # only by the MIN_LINKS floor).
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for target in _LINK_RE.findall(line):
            yield lineno, target


_ROW_RE = re.compile(r'<tr data-id="([^"]+)"><td class="id"><a href="([^"]+)"')


SPECS_DIR = "docs/superpowers/specs"
SEED_PREFIX = "template/seed/"


def _local_mode() -> bool:
    """True when the maintainer's working half is present on disk.

    Detected from the DISK, never from a CI environment variable. An env var is
    a flag anyone can set wrong; the disk is the actual condition every
    assertion below depends on. In CI the working half is absent because it is
    gitignored -- which is not a degraded run, it is the state this repo exists
    in for everyone except its maintainer.
    """
    return (_repo_root() / SPECS_DIR).is_dir()


def _check_ignore(path: str) -> bool:
    r = subprocess.run(["git", "check-ignore", "-q", "--no-index", path],
                       cwd=_repo_root(), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode == 0


def _deliberately_unpublished(rel: str) -> bool:
    """Does git say this path is ignored on purpose?

    Asks git rather than keeping a list, because a list drifts from the rules it
    duplicates. Exit 0 = ignored, 1 = not ignored, 128 = git could not answer.
    ONLY a clean 0 counts: an error must never be read as permission to skip,
    which is how an escape hatch turns a guard vacuous.

    Retries with a trailing slash if the bare form comes back unconfirmed, and
    ONLY then: `git check-ignore --no-index` matches a directory-only rule
    (`/docs/`) only when it can tell the argument names a directory, and with
    `--no-index` its one source of that information is the filesystem. In CI
    the withheld directories never exist on disk at all -- that is the point
    of ignoring them -- so a bare "docs" leaves git unable to tell and it
    answers "not ignored" even though the rule plainly covers it. A trailing
    slash removes the ambiguity without needing the path to exist. Tried
    second, not first, because the bare form is the one that resolves on its
    own whenever it can: a rule anchored to a bare filename (`/BACKLOG.html`)
    matches either spelling, slash or none, so the retry never has to fire for
    it. It only ever fires for the directory-only rules (`/docs/`,
    `/.superpowers/`) where an absent directory is exactly the ambiguity the
    bare form cannot resolve by itself. (Checked directly: `git check-ignore
    --no-index BACKLOG.html/` also returns 0 -- a file-only rule answers the
    same way both ways, it is not a reason the retry is safe, just a reason it
    is unneeded there.)
    """
    if _check_ignore(rel):
        return True
    if not rel.endswith("/"):
        return _check_ignore(rel + "/")
    return False


MIN_MD_FILES = 5
MIN_LINKS_LOCAL = 12
MIN_LINKS_CI = 6
MIN_ROWS = 8
PUBLIC_MD_MAX_LINES = 35


def test_the_working_material_is_never_tracked():
    """Runs in BOTH modes, because a leak switches the other assertions off.

    Every visibility check elsewhere in this file is gated on _local_mode(),
    which infers the mode from whether the working material is on disk.
    Publishing that material therefore flips the guard into LOCAL mode, where
    it stops asking whether the material should be there at all and starts
    checking that the page is well-formed -- which it is. A fully leaked
    repository passes every other assertion here.

    This one asks git directly, and the answer does not depend on the mode.

    PUBLIC.md is checked in this same function rather than its own, because
    it is the mirror image of the check above it: one direction says a set of
    paths must stay untracked, the other says this one file must exist,
    stay tracked, and stay small. Both are mode-independent for the same
    reason -- PUBLIC.md ships in every clone, leaked or not -- so splitting
    them into two functions would not change what either one verifies.
    """
    out = subprocess.run(
        ["git", "ls-files", "--", "docs/", "CLAUDE.md",
         "DEVELOPMENT-CHECKLIST.md", "BACKLOG.html", ".superpowers/"],
        cwd=_repo_root(), capture_output=True, check=True, text=True,
        encoding="utf-8", errors="replace",
    ).stdout or ""
    tracked = [p for p in out.split("\n") if p]
    assert tracked == [], (
        "working material is TRACKED and publishes on the next push: " + ", ".join(tracked)
    )
    # "docs/" and ".superpowers/", trailing slash and all: they name directories,
    # and _deliberately_unpublished() needs that spelled out on a CI checkout,
    # where neither exists on disk to tell it that itself.
    #
    # .superpowers/ is listed alongside the four rules under the public/private
    # banner in .gitignore even though its own rule sits above that banner: it is
    # the same class of leak (real working material -- this very branch's ledgers
    # and review diffs), and a hardcoded list that covers only the four banner
    # rules would stay green while a maintainer removed .superpowers/'s rule and
    # committed the directory. Neither this assertion nor check_leaks.py catches
    # that by any OTHER means -- check_leaks.py's patterns are shaped to match
    # credential and inventory PROSE, not "a previously-ignored path is now
    # tracked", so this hardcoded list is the only place that check lives.
    for p in ("docs/", "CLAUDE.md", "DEVELOPMENT-CHECKLIST.md", "BACKLOG.html", ".superpowers/"):
        assert _deliberately_unpublished(p), f"{p} is no longer covered by .gitignore"

    # F2: PUBLIC.md is the highest-risk file in this repo -- the one whose whole
    # job is to describe what is absent -- and before this it had no check of
    # its own, only whatever the generic *.md link walk happened to touch.
    public_md = _repo_root() / "PUBLIC.md"
    assert public_md.is_file(), "PUBLIC.md is missing -- the mirror document must exist"
    lines = public_md.read_text(encoding="utf-8").splitlines()
    assert len(lines) <= PUBLIC_MD_MAX_LINES, (
        f"PUBLIC.md is {len(lines)} lines, over the {PUBLIC_MD_MAX_LINES}-line cap -- see "
        "design doc S6: it must say almost nothing, and a growing page is the shape an "
        "inventory of what is withheld creeps in as"
    )


def test_every_markdown_link_resolves():
    """Resolution, from each file's own directory -- and in CI, an honest count
    of what could not be resolved because its target is unpublished.

    The escape hatch is the dangerous part. Skipping every link whose target is
    ignored would make this vacuous in BOTH modes at once while reporting
    success, because in this repo most such targets ARE ignored. So the skipped
    ones are COUNTED and asserted on, not waved through.
    """
    files = _scannable("*.md")
    assert len(files) >= MIN_MD_FILES, f"only {len(files)} markdown files — the walk is broken"

    broken, checked, unpublished = [], 0, 0
    for rel in files:
        if rel.startswith(SEED_PREFIX):
            # template/seed/ is scaffolding payload, installed by init_project.py to a
            # path two directories shallower than where it currently sits tracked (e.g.
            # template/seed/docs/knowledge/README.md becomes docs/knowledge/README.md at
            # the repository root). Its relative links are authored for THAT destination,
            # not for the path this walk finds it at -- so resolution below uses the
            # POST-INSTALL path as the base, not the tracked one. Resolving against the
            # tracked path would flag every seed link as broken; resolving against the
            # install destination checks what the link actually means, including letting
            # a target that is legitimately gitignored post-install (BACKLOG.html,
            # docs/knowledge/, ...) reach the escape hatch below like any other link.
            base = Path(rel[len(SEED_PREFIX):]).parent
        else:
            base = Path(rel).parent
        for lineno, target in _iter_markdown_links(_read(rel)):
            if re.match(r"^(?:https?:|mailto:|#)", target):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            # posixpath.normpath, not .lstrip("./") -- lstrip strips a CHARACTER SET
            # from the left, repeatedly, not the literal prefix "./". A link into
            # .github/ (e.g. from README.md, base ".") joins to ".github/x", and
            # lstrip("./") also eats the leading "." OF .github ITSELF, querying
            # git about "github/x" instead. That path happens to not be ignored
            # either, so today this fails safe -- but it is asking about the wrong
            # path, and a project that gitignored something under a dot-directory
            # would see this silently let it through.
            resolved = posixpath.normpath((base / path_part).as_posix())
            if not (_repo_root() / base / path_part).exists():
                if _deliberately_unpublished(resolved):
                    unpublished += 1
                    continue
                broken.append(f"{rel}:{lineno} -> {target}")
            checked += 1

    floor = MIN_LINKS_LOCAL if _local_mode() else MIN_LINKS_CI
    mode = "LOCAL" if _local_mode() else "CI"
    assert checked >= floor, (
        f"{mode} mode: only {checked} links resolved (floor {floor}) — the scan may be vacuous"
    )
    print(f"[{mode}] {checked} links resolved, {unpublished} unresolvable "
          f"because their target is deliberately unpublished")
    assert broken == [], "links whose target does not resolve: " + ", ".join(broken)


def test_every_backlog_row_links_to_a_spec_that_exists():
    """LOCAL: every row resolves. CI: there is no page to have rows at all,
    and git confirms that absence is deliberate -- the same inversion as the
    other two page assertions below.
    """
    if not _local_mode():
        assert not (_repo_root() / "BACKLOG.html").exists(), (
            "BACKLOG.html is present in a tree with no specs — it must never be committed"
        )
        assert _deliberately_unpublished("BACKLOG.html"), (
            "BACKLOG.html is not covered by .gitignore — it would be published on the next commit"
        )
        print("[CI] no page to parse rows from — visibility rule checked instead")
        return

    page = _read("BACKLOG.html")
    rows = _ROW_RE.findall(page)
    assert len(rows) >= MIN_ROWS, (
        f"only {len(rows)} backlog rows parsed — the page may have lost rows "
        f"or changed shape"
    )
    missing = [f"{tid} -> {href}" for tid, href in rows
               if not (_repo_root() / href).exists()]
    assert missing == [], "backlog rows linking to nothing: " + ", ".join(missing)


def test_the_backlog_rows_are_markup_not_script_data():
    """LOCAL: the whole point of the generated page -- a script parse error
    must not be able to blank it. CI: same inversion as every other page
    assertion, since there is no page to inspect at all.
    """
    if not _local_mode():
        assert not (_repo_root() / "BACKLOG.html").exists(), (
            "BACKLOG.html is present in a tree with no specs — it must never be committed"
        )
        assert _deliberately_unpublished("BACKLOG.html"), (
            "BACKLOG.html is not covered by .gitignore — it would be published on the next commit"
        )
        print("[CI] no script data to inspect — visibility rule checked instead")
        return

    page = _read("BACKLOG.html")

    # <style> is stripped before counting script tags, so a CSS comment that
    # merely mentions "<script>" as prose is never mistaken for an element.
    # A non-greedy "<script>...</script>" match otherwise starts at the FIRST
    # literal "<script>" anywhere in the file -- including inside <style> --
    # and swallows most of the document, reporting every ticket as leaked.
    outside_style = re.sub(r"(?s)<style>.*?</style>", "", page)
    n = len(re.findall(r"<script\b", outside_style))
    assert n == 1, (
        f"expected exactly one <script> element outside <style>, found {n} — "
        f"a second would go unchecked, since this guard only inspects one"
    )

    m = re.search(r'(?s)<script id="backlog-filter">(.*?)</script>', page)
    assert m, 'BACKLOG.html should carry its filter script (id="backlog-filter")'
    body = m.group(1)

    leaked = [tid for tid, _ in _ROW_RE.findall(page) if tid in body]
    assert leaked == [], (
        "ticket data inside <script>: " + ", ".join(leaked)
        + " — rows must live in markup so a script parse error cannot blank the page"
    )


def test_the_page_is_actually_the_specs_rendered():
    """LOCAL: the committed page equals render(). CI: the page is ABSENT, and
    git confirms that is deliberate.

    The CI half is not a weaker version of the local one -- it is a different
    assertion that happens to be the one that matters there. In CI this guard
    stops being able to check the content and starts proving the VISIBILITY
    RULE still holds, which is the thing that actually goes wrong in a public
    repo.
    """
    page = _repo_root() / "BACKLOG.html"
    if not _local_mode():
        assert not page.exists(), (
            "BACKLOG.html is present in a tree with no specs — it must never be committed"
        )
        assert _deliberately_unpublished("BACKLOG.html"), (
            "BACKLOG.html is not covered by .gitignore — it would be published on the next commit"
        )
        print("[CI] page correctly absent and confirmed ignored")
        return

    sys.path.insert(0, str(_repo_root() / "scripts"))
    import build_backlog_html
    assert _read("BACKLOG.html") == build_backlog_html.render(), (
        "BACKLOG.html is stale — it is not what docs/superpowers/specs/ currently renders to. "
        "Run: python scripts/build_backlog_html.py"
    )


def test_the_index_still_agrees_with_its_source():
    """A stale page is internally flawless. Every inward-looking assertion --
    rows well-formed, links resolving, counts matching -- passes on a page whose
    status column is out of date. This one looks OUTWARD: id set and status,
    against the specs as they are NOW.
    """
    if not _local_mode():
        assert not (_repo_root() / "BACKLOG.html").exists()
        print("[CI] no page to compare — visibility rule checked instead")
        return

    page = _read("BACKLOG.html")
    rows = dict(re.findall(r'<tr data-id="([^"]+)".*?<span class="chip chip-\w+">(\w+)</span>', page))
    specs = {}
    for path in sorted((_repo_root() / SPECS_DIR).glob("*.md")):
        text = path.read_text(encoding="utf-8")
        tid = re.match(r"^#\s+(\S+)", text).group(1)
        specs[tid] = re.search(r"^\*\*Status:\*\*\s*(\S+)", text, re.M).group(1)

    assert set(rows) == set(specs), (
        f"page and specs disagree — only in page: {sorted(set(rows) - set(specs))}, "
        f"only in specs: {sorted(set(specs) - set(rows))}. "
        "Run: python scripts/build_backlog_html.py"
    )
    wrong = {k: (rows[k], specs[k]) for k in specs if rows[k] != specs[k]}
    assert not wrong, (
        f"page shows a status the spec no longer has: {wrong}. "
        "Run: python scripts/build_backlog_html.py"
    )


PLACEHOLDERS = ("<PROJECT_NAME>", "<PROJECT_ONE_LINE>", "<GITHUB_OWNER>",
                "<CONTACT_EMAIL>", "<YYYY-MM-DD>")
LICENCE_TOKEN = "<LICENCE_NOT_CHOSEN>"

PLACEHOLDER_EXEMPT = frozenset({
    "tests/test_docs_integrity.py",   # holds the tokens as data, not as placeholders
    "scripts/init_project.py",        # fills them; naming them is its job
    "LICENSE",                        # checked separately below, with its own message
})


def test_no_placeholder_survives():
    files = _scannable("*.md", "*.py", "*.html", "*.yml", "*.yaml",
                       ".gitignore", ".gitattributes", ".editorconfig")
    assert len(files) >= MIN_MD_FILES, f"only {len(files)} files — the walk is broken"

    offenders, scanned = [], 0
    for rel in files:
        if rel in PLACEHOLDER_EXEMPT or rel.startswith("template/"):
            continue
        text = _read(rel)
        scanned += 1
        offenders += [f"{rel} still contains {ph}" for ph in PLACEHOLDERS if ph in text]

    assert scanned > 0, "no files read — the scan is vacuous"
    assert offenders == [], (
        "placeholders remain — run `python scripts/init_project.py`: " + ", ".join(offenders)
    )


def test_a_licence_has_been_chosen():
    """Separate from the placeholder test on purpose, with its own message.

    Every other placeholder means init has not run. This one means a HUMAN has
    not decided, and it stays red after a successful bootstrap by design --
    replacing it is the intended first act of a new project. An unlicensed
    public repository grants no rights at all.
    """
    assert LICENCE_TOKEN not in _read("LICENSE"), (
        "LICENSE still holds " + LICENCE_TOKEN + " — choose one and replace the whole file. "
        "See ticket D5. An unlicensed public repo grants no rights at all."
    )

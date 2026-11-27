"""The documentation site: the guide's pages, built by VitePress and published after a release.

The build itself is a step of the gate (`npm run docs:build`); it fails on a dead link. What a
build cannot see is held here: a page the sidebar leaves out, a changelog page that starts in
the wrong place, and a workflow that would publish a version whose release failed.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "guide"
WORKFLOW = ROOT / ".github" / "workflows" / "docs.yml"

# Pages of the site that are not pages of the guide: the home page, the guide's own index, and
# the changelog. Each other page is one row of the table in guide/README.md.
NOT_GUIDE_PAGES = {"index.md", "README.md", "changelog.md"}

# The same shape the site's config reads its sidebar with (guide/.vitepress/config.ts).
_ROW_RE = re.compile(r"^\| \[([^\]]+)\]\(([\w-]+)\.md\) \|", re.MULTILINE)


def _table_pages(text: str) -> list[str]:
    return [f"{name}.md" for _, name in _ROW_RE.findall(text)]


def _page_problems(on_disk: set[str], in_table: list[str]) -> list[str]:
    problems = [f"{page} is not in the table of guide/README.md, so the site's sidebar leaves it out"
                for page in sorted(on_disk - set(in_table))]
    problems += [f"the table names {page}, and there is no such page" for page in in_table if page not in on_disk]
    problems += [f"the table names {page} twice" for page in sorted({p for p in in_table if in_table.count(p) > 1})]
    return problems


def test_a_page_left_out_of_the_table_or_named_but_missing_is_found():
    assert _page_problems({"a.md", "b.md"}, ["a.md", "b.md"]) == []
    assert _page_problems({"a.md", "b.md"}, ["a.md"]) == [
        "b.md is not in the table of guide/README.md, so the site's sidebar leaves it out"
    ]
    assert _page_problems({"a.md"}, ["a.md", "c.md"]) == ["the table names c.md, and there is no such page"]
    assert _page_problems({"a.md"}, ["a.md", "a.md"]) == ["the table names a.md twice"]


def test_every_page_of_the_guide_is_in_the_sidebar_once():
    in_table = _table_pages((GUIDE / "README.md").read_text(encoding="utf-8"))
    on_disk = {p.name for p in GUIDE.glob("*.md")} - NOT_GUIDE_PAGES
    assert len(in_table) >= 9, f"only {len(in_table)} rows were read from the table: the check is vacuous"
    assert _page_problems(on_disk, in_table) == []


def test_the_changelog_page_starts_at_the_newest_release():
    page = (GUIDE / "changelog.md").read_text(encoding="utf-8")
    found = re.findall(r"<!--@include: \.\./CHANGELOG\.md\{(\d+),\}-->", page)
    assert len(found) == 1, "guide/changelog.md must include CHANGELOG.md once, from a line number on"
    lines = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8").splitlines()
    first_release = next(i for i, line in enumerate(lines, start=1) if line.startswith("## "))
    assert int(found[0]) == first_release, (
        f"the page includes CHANGELOG.md from line {found[0]}, and the newest release starts on line "
        f"{first_release}: the intro above it is for the maintainer, and a release would be cut"
    )


def test_the_site_is_published_only_after_a_release_that_succeeded_or_by_hand():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert re.search(r'^  workflow_run:\n    workflows: \["release"\]\n    types: \[completed\]$', text, re.M)
    assert re.search(r"^  workflow_dispatch:$", text, re.M)
    assert not re.search(r"^  (push|pull_request|schedule):", text, re.M), "the site follows releases only"
    assert (
        "if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'"
        in text
    ), "a release that failed must not publish its site"
    # The release's own commit, not whatever main holds when the release finishes.
    assert "ref: ${{ github.event.workflow_run.head_sha || github.sha }}" in text


def test_the_workflow_publishes_the_folder_the_build_writes():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "run: npm run docs:build" in text
    assert "path: guide/.vitepress/dist" in text
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "guide/.vitepress/dist/" in ignored, "the built site is never committed"


SITE = "https://ank-khoaho.github.io/wemock/"


def _site_link_problems(readme: str, pages: set[str]) -> list[str]:
    """Each link from the README into the site names a page the site builds."""
    problems = []
    for slug, _anchor in re.findall(re.escape(SITE) + r"([\w-]*)(#[\w-]+)?\)", readme):
        if slug and f"{slug}.md" not in pages:
            problems.append(f"the README links {SITE}{slug}, and guide/ has no {slug}.md")
    return problems


def test_a_readme_link_to_a_page_the_site_lacks_is_found():
    readme = f"[a]({SITE}install) [b]({SITE}replies#stream) [home]({SITE}) [c]({SITE}nowhere)"
    assert _site_link_problems(readme, {"install.md", "replies.md"}) == [
        f"the README links {SITE}nowhere, and guide/ has no nowhere.md"
    ]


def test_every_readme_link_into_the_site_names_a_page_of_it():
    # The site's build finds a dead link between its own pages; it never reads the README.
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    pages = {p.name for p in GUIDE.glob("*.md")}
    assert readme.count(SITE) >= 10, "too few links into the site were read: the check is vacuous"
    assert _site_link_problems(readme, pages) == []

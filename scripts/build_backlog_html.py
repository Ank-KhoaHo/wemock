"""Generate BACKLOG.html from the per-ticket specs.

NOT CI-WIRED, AND CANNOT BE. In this repository both this script's input
(docs/superpowers/specs/) and its output (BACKLOG.html) are gitignored, so no
workflow can ever run it -- CI cannot see either one. It is tracked anyway,
because the index is a VIEW over the specs and a view nothing regenerates goes
stale. Run it by hand after editing a spec. tests/test_docs_integrity.py checks
the result locally, and in CI checks only that the page is still absent.

ROWS ARE WRITTEN AS HTML MARKUP, NEVER AS A JS DATA STRUCTURE. If the script
tag fails to parse, every row must still render and a plain-text search for any
ticket ID in BACKLOG.html must still find it. Grouping uses native
<details>/<summary>, so no JavaScript is involved in that either.

The ID is read from each spec's own `# <ID>` heading, never from
`name.split("-")[0]`. Filename splitting happens to work while every ID is a
bare letter+number and stops working the first time a compound ID like `A3-a`
is filed -- silently, merging distinct tickets onto one row.
"""

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECS = ROOT / "docs" / "superpowers" / "specs"

# Workflow order, unchanged from the order CLAUDE.md and the page footer
# already document: it exists so DONE and DROPPED are never adjacent.
GROUP_ORDER = ("OPEN", "ACCEPTED", "DONE", "SUSPENDED", "DROPPED")
# DONE is usually the largest group by far and would otherwise bury the
# handful of rows that are actually actionable.
COLLAPSED = {"DONE"}

_HEADING_RE = re.compile(r"^#\s+([A-Za-z0-9-]+)\s*$")
_STATUS_RE = re.compile(r"^\*\*Status:\*\*\s*(.+?)\s*$", re.M)
_SECTION_RE = re.compile(r"^\*\*Section:\*\*\s*(.+?)\s*$", re.M)
# The rendered `Sec` cell is `section.split(" — ")[0]`, so a section written with an
# ASCII hyphen instead of an em dash silently renders the WHOLE string into a
# one-letter column, and a section letter disagreeing with the ticket's own ID
# silently files the row under the wrong heading. Both pass every assertion in
# tests/test_docs_integrity.py -- the same shape the status check above exists for.
_SECTION_FMT_RE = re.compile(r"^([ABCD]) — \S")
_SUMMARY_RE = re.compile(r"^## Detail\s*\n+\*\*(.+?)\*\*\s*$", re.M)

# Ticket IDs are section letter + number, optionally a sub-item suffix (`A3-a`).
# Validated rather than trusted: `tests/test_docs_integrity.py` asserts no ticket
# ID appears inside the page's <script>, so an ID like `q` or `try` -- the search
# input's DOM id, and a keyword -- would break that guard against the script's own
# FUNCTIONAL code, where no rewording could rescue it. Widen this deliberately if
# the convention ever changes; do not widen it to make one spec parse.
_TICKET_ID_RE = re.compile(r"^[ABCD][0-9]{1,2}(?:-[A-Za-z0-9]+)?$")


def _collect_tickets() -> list[tuple[str, str, str, str, str]]:
    """Parse every ticket spec into (id, status, section, summary, filename)."""
    tickets = []
    for path in sorted(SPECS.glob("*.md")):
        if re.match(r"^20[0-9]{2}-", path.name):
            continue  # dated design/plan docs are not tickets
        text = path.read_text(encoding="utf-8")

        heading = _HEADING_RE.match(text.split("\n", 1)[0])
        if not heading:
            raise SystemExit(f"{path.name}: first line must be '# <ID>'")
        tid = heading.group(1)

        if not _TICKET_ID_RE.match(tid):
            raise SystemExit(f"{path.name}: {tid!r} is not a ticket ID (expected e.g. A12)")

        status = _STATUS_RE.search(text)
        section = _SECTION_RE.search(text)
        summary = _SUMMARY_RE.search(text)
        if not (status and section and summary):
            raise SystemExit(f"{path.name}: missing Status, Section or summary")

        # A mistyped status (wrong case, or a word outside the closed set) must
        # not reach _group_tickets(): left unvalidated, it silently starts its
        # own group there instead of joining the one the writer meant, and a
        # second ticket with the SAME mistyped status collides on the group's
        # id= attribute -- both invisible to every existing assertion. Use
        # SystemExit, not assert: this file already converted its others
        # because asserts vanish under -O, and a build that "succeeds" with a
        # silently split backlog is worse than one that refuses to run.
        status_value = status.group(1).strip()
        if status_value not in GROUP_ORDER:
            raise SystemExit(
                f"{path.name}: status {status_value!r} is not one of the five "
                f"valid statuses: {', '.join(GROUP_ORDER)}"
            )

        section_value = section.group(1).strip()
        section_match = _SECTION_FMT_RE.match(section_value)
        if not section_match:
            raise SystemExit(
                f"{path.name}: section {section_value!r} must read "
                f"'<A|B|C|D> — <name>', with an em dash"
            )
        if section_match.group(1) != tid[0]:
            raise SystemExit(
                f"{path.name}: section {section_match.group(1)!r} does not match "
                f"ticket id {tid!r} -- the row would file under the wrong heading"
            )

        tickets.append((tid, status_value, section_value,
                        summary.group(1).strip(), path.name))

    # Use explicit SystemExit rather than assert so the check runs under -O / PYTHONOPTIMIZE=1.
    # An assert here would vanish, reintroducing the silent-empty-backlog failure.
    if not tickets:
        raise SystemExit("no ticket specs found — the glob is broken")
    if len({t[0] for t in tickets}) != len(tickets):
        raise SystemExit("duplicate ticket IDs")

    return tickets


def _group_tickets(
    tickets: list[tuple[str, str, str, str, str]],
) -> tuple[dict[str, list[str]], list[str]]:
    """Bucket rendered rows by status, and return the group display order."""
    groups: dict[str, list[str]] = {label: [] for label in GROUP_ORDER}
    for tid, status, section, summary, name in tickets:
        # An unknown status is rendered loudly rather than given a plausible
        # name, and gets its own group so it can never vanish silently. This
        # branch should now be UNREACHABLE: _collect_tickets() rejects any
        # status outside GROUP_ORDER with a SystemExit before a ticket ever
        # reaches this function. Left in place as a second line of defence,
        # not a path this code expects to take.
        css = status.lower() if status in GROUP_ORDER else "unknown"
        href = f"docs/superpowers/specs/{name}"
        groups.setdefault(status, []).append(
            '<tr data-id="{i}"><td class="id"><a href="{h}">{i}</a></td>'
            '<td class="sum">{s}</td><td class="sec">{c}</td>'
            '<td><span class="chip chip-{k}">{t}</span></td></tr>'.format(
                i=html.escape(tid), h=html.escape(href), s=html.escape(summary),
                c=html.escape(section.split(" — ")[0]), k=css, t=html.escape(status))
        )

    labels = [l for l in GROUP_ORDER if groups.get(l)]
    labels += sorted(l for l in groups if groups[l] and l not in GROUP_ORDER)
    return groups, labels


def render() -> str:
    """Build the complete page text from the specs. Writes nothing.

    This is the refactor's central seam: it is the one function that can be
    called both to produce `BACKLOG.html` and to check, in a test, that the
    committed file IS what it produces -- rather than something that merely
    looks well-formed on its own.
    """
    tickets = _collect_tickets()
    groups, labels = _group_tickets(tickets)

    out = []
    for label in labels:
        rows = groups[label]
        # An unrecognized status is raw spec text, never escaped above, so its
        # interpolation into the id= attribute must escape it to prevent breakout.
        out.append(
            '<details class="group" id="g-{gid}"{o}><summary>{l} '
            '<span class="count">({n})</span></summary>\n'
            '<table><thead><tr><th>ID</th><th>Summary</th><th>Sec</th><th>Status</th></tr>'
            '</thead>\n<tbody>\n{r}\n</tbody></table>\n</details>'.format(
                gid=html.escape(label.lower()), o="" if label in COLLAPSED else " open",
                l=html.escape(label), n=len(rows), r="\n".join(rows))
        )

    template = (ROOT / "scripts" / "backlog_template.html").read_text(encoding="utf-8")
    return (template.replace("<!--GROUPS-->", "\n".join(out))
                     .replace("<!--COUNT-->", str(len(tickets))))


def main() -> None:
    text = render()
    (ROOT / "BACKLOG.html").write_text(text, encoding="utf-8", newline="\n")

    # Recomputed rather than threaded out of render(), which must stay a pure
    # str-in-str-out function -- it is the thing a test diffs the file against.
    tickets = _collect_tickets()
    groups, labels = _group_tickets(tickets)
    print(f"wrote BACKLOG.html with {len(tickets)} rows in {len(labels)} groups")
    for label in labels:
        print(f"  {label:<10} {len(groups[label])}")


if __name__ == "__main__":
    main()

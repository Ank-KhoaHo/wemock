"""Tests of README.md's shape: it is the page a stranger decides on, and it is scanned, not read.

Four rules, each one something a project made from this template had to go back and fix:

* it has the one shape every README here has: the same sections, by the same names, in the
  same order, so a reader who has seen one knows where to look in the next
* its first section says what the thing is, in plain sentences
* it stays short enough to scan
* its sentences stay short: the average, and the longest

The numbers are caps, not targets. Three well-liked READMEs measured 13, 15 and 20 words a
sentence on average, in 120 to 320 lines. Raise a cap on purpose, in this file, with the reason.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

README_MAX_LINES = 300
README_MAX_AVERAGE_WORDS = 18
README_MAX_SENTENCE_WORDS = 30

_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_LIST_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
# A line that is markup, not something a reader reads as a sentence: a heading, a table row,
# a quote marker, an HTML tag or comment. A line that opens with an upper-case token in angle
# brackets is none of these: the token stands where a word will be.
_NOT_PROSE_RE = re.compile(r"^\s*(?:#|\||>|<!--|</?[a-z])")
# A thematic break (---, ***, ___) is a line drawn across the page, not a sentence. A README
# that rules off its badges from the text below them is common.
_BREAK_RE = re.compile(r"^\s*(?:[-*_]\s*){3,}$")


def _prose(text: str) -> str:
    """The words a reader reads: no code blocks, tables, headings, HTML, images or link targets."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    kept, in_fence = [], False
    for line in text.split("\n"):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or _NOT_PROSE_RE.match(line) or _BREAK_RE.match(line):
            kept.append("")                         # markup ends the paragraph around it
            continue
        if _LIST_ITEM_RE.match(line):
            kept.append("")                         # each list item is its own paragraph
            line = _LIST_ITEM_RE.sub("", line)
        kept.append(line)
    text = "\n".join(kept)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)        # an image is not a word
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)    # a link keeps its words
    text = re.sub(r"`[^`]*`", "code", text)                 # inline code reads as one word
    return re.sub(r"[*_]{1,3}", "", text)                   # emphasis marks are not words


def _sentences(text: str) -> list[str]:
    """Every sentence of the prose, one string each, in reading order."""
    found = []
    for paragraph in re.split(r"\n\s*\n", _prose(text)):
        flat = " ".join(paragraph.split())
        found += [piece for piece in re.split(r"(?<=[.!?:])\s+", flat) if re.search(r"\w", piece)]
    return found


def _headings(text: str) -> list[str]:
    in_fence, found = False, []
    for line in text.split("\n"):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
        elif not in_fence and re.match(r"^#{2,6}\s+\S", line):
            found.append(line.lstrip("#").strip())
    return found


def _first_paragraph(text: str) -> str:
    """The first paragraph of prose under the title."""
    body = text.split("\n", 1)[1] if text.startswith("# ") else text
    for paragraph in re.split(r"\n\s*\n", _prose(body)):
        flat = " ".join(paragraph.split())
        if flat:
            return flat
    return ""


def _readme() -> str:
    return (ROOT / "README.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------- the README's shape

README_BEFORE = ("What it is", "Get started", "How to use it")
README_AFTER = ("Status", "Limits", "Alternatives", "FAQ", "Documentation", "Licence")
README_REQUIRED = ("What it is", "Get started", "Status", "Documentation")
README_REQUIRED_PUBLIC = README_REQUIRED + ("Limits", "Alternatives", "FAQ", "Licence")

_ITALIC_RE = re.compile(r"^\*[^*].*[^*]\*$")


def readme_shape_problems(text: str, public: bool = False, banner: bool = False) -> list[str]:
    """Return every way this README leaves the standard shape, one sentence each.

    Every README in this template and projects made from it shares one outline so
    a reader who has seen one knows where to look in the next.
    """
    lines = text.splitlines()
    in_fence = False
    fence_char = ""

    top_raw: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current_section_name: str | None = None
    current_section_body: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not in_fence:
            if stripped.startswith("```"):
                in_fence = True
                fence_char = "`"
                if current_section_name is None:
                    top_raw.append(line)
                else:
                    current_section_body.append(line)
            elif stripped.startswith("~~~"):
                in_fence = True
                fence_char = "~"
                if current_section_name is None:
                    top_raw.append(line)
                else:
                    current_section_body.append(line)
            elif line.startswith("## "):
                if current_section_name is not None:
                    sections.append((current_section_name, current_section_body))
                current_section_name = line[3:].strip()
                current_section_body = []
            else:
                if current_section_name is None:
                    top_raw.append(line)
                else:
                    current_section_body.append(line)
        else:
            if (fence_char == "`" and stripped.startswith("```")) or (fence_char == "~" and stripped.startswith("~~~")):
                in_fence = False
                fence_char = ""
            if current_section_name is None:
                top_raw.append(line)
            else:
                current_section_body.append(line)

    if current_section_name is not None:
        sections.append((current_section_name, current_section_body))

    # Blank lines aside, the top is read as it is written. A note above the title is allowed in a
    # project with no banner; a project with a banner opens with it, and with nothing else.
    top = [line for line in top_raw if line.strip()]

    problems: list[str] = []

    if banner:
        if not top:
            problems.append("the banner is not the first thing in the file")
        else:
            first = top[0].strip()
            if not (first.startswith("![") or "<img" in first):
                problems.append("the banner is not the first thing in the file")

    title_indices = [idx for idx, line in enumerate(top) if line.startswith("# ")]
    if len(title_indices) != 1:
        problems.append(f"expected one '# Name' line above the first section, found {len(title_indices)}")
    else:
        title_idx = title_indices[0]
        lines_after_title = top[title_idx + 1:]

        if not any(_ITALIC_RE.match(line.strip()) for line in lines_after_title):
            problems.append("no one-line description in italics under the name")

        if not any(("`" in line or "<img" in line or "[![" in line) for line in lines_after_title):
            problems.append("no facts line (badges or `code chips`) under the name")

    required = README_REQUIRED_PUBLIC if public else README_REQUIRED
    section_names = [name for name, _ in sections]
    for req in required:
        if req not in section_names:
            problems.append(f"no section called '{req}'")

    FIXED = README_BEFORE + README_AFTER
    highest = -1
    own_seen = False
    after_seen = False

    for name in section_names:
        if name in FIXED:
            i = FIXED.index(name)
            if i < highest:
                problems.append(f"'{name}' is out of order")
            elif name in README_BEFORE and own_seen:
                problems.append(f"'{name}' comes after the project's own sections: it belongs before them")
            highest = max(highest, i)
            if name in README_AFTER:
                after_seen = True
        else:
            if after_seen:
                problems.append(f"'{name}' is a section of the project's own, after 'Status': its one slot is before 'Status'")
            else:
                own_seen = True

    if section_names and section_names[0] != "What it is":
        problems.append(f"the first section is '{section_names[0]}', not 'What it is'")

    for name, body in sections:
        if not any(line.strip() for line in body):
            problems.append(f"'{name}' has nothing under it")

    return problems


# ---------------------------------------------------------------- the reader of these rules


SAMPLE = "\n".join([
    "# Widget Forge",
    "",
    "[![build](https://example.com/badge.svg)](https://example.com/ci)",
    "",
    "Widget Forge makes one widget. It is for **people** who need [one](https://example.com/one).",
    "",
    "<!-- a note for maintainers. It has sentences. They do not count. -->",
    "",
    "## Install",
    "",
    "```",
    "widget-forge install. This is code. Not a sentence.",
    "```",
    "",
    "| Where | State |",
    "|---|---|",
    "| Windows. Linux. | tried |",
    "",
    "- Run `widget-forge --help` first.",
    "- Then read the limits!",
    "",
])


def test_only_what_a_reader_reads_is_counted():
    assert _sentences(SAMPLE) == [
        "Widget Forge makes one widget.",
        "It is for people who need one.",
        "Run code first.",
        "Then read the limits!",
    ]


def test_headings_inside_a_code_block_are_not_headings():
    text = "\n".join(["# Title", "", "## Real", "", "```", "## Not real", "```", "", "### Deeper", ""])
    assert _headings(text) == ["Real", "Deeper"]


def test_the_first_paragraph_is_the_first_prose_under_the_title():
    assert _first_paragraph(SAMPLE) == "Widget Forge makes one widget. It is for people who need one."
    only_badges = "\n".join(["# Title", "", "![logo](logo.png)", "", "## Install", "", "Run it.", ""])
    assert _first_paragraph(only_badges) == "Run it.", "an image alone is not a paragraph of prose"
    ruled_off = "\n".join(["# Title", "", "![logo](logo.png)", "", "---", "", "It does one thing.", ""])
    assert _first_paragraph(ruled_off) == "It does one thing.", "a line drawn across the page is not prose"


def test_a_line_drawn_across_the_page_is_not_prose():
    """`---`, `***` and `___` rule off one part of a page from the next. One project ruled
    off its badges from its text, and the rule was read as the README's first paragraph."""
    for rule in ("---", "***", "___", "- - -", "* * *", "  ----------  "):
        text = "\n".join(["Before the line", rule, "after the line.", ""])
        assert _sentences(text) == ["Before the line", "after the line."], f"{rule!r} did not end the paragraph"
    # Two marks are not a rule, and neither is a line that holds anything else.
    assert _sentences("One thing --\nand another.\n") == ["One thing -- and another."]
    assert _sentences("One thing\n--\nand another.\n") == ["One thing -- and another."]
    assert _sentences("First\n--- a note ---\nlast.\n") == ["First --- a note --- last."]


# ---------------------------------------------------------------- the README itself


def test_the_readme_has_the_one_shape():
    """README.md has the one shape, with the sections a public project needs.

    A rule that only said which sections must exist gave every README its own outline: the
    names and the order are what a reader learns once. Status says what was really tried,
    Limits what it does not do, Alternatives when something else is the better choice, and
    the FAQ answers what is asked first.
    """
    banner = (ROOT / "art" / "banner.png").exists()
    problems = readme_shape_problems(_readme(), public=True, banner=banner)
    assert not problems, (
        f"README.md leaves the one shape every README here has: {'; '.join(problems)}. "
        f"The order is: the banner (when art/banner.png exists), '# Name', the badges, one line "
        f"in italics; then 'What it is', 'Get started', 'How to use it' (optional), the project's "
        f"own sections, 'Status', 'Limits', 'Alternatives', 'FAQ', 'Documentation', 'Licence'"
    )


def test_the_first_section_says_what_this_is():
    parts = _readme().split("\n## What it is", 1)
    assert len(parts) == 2, "README.md has no section called 'What it is'"
    first = _first_paragraph(parts[1].split("\n## ", 1)[0])
    assert len(first.split()) >= 6, (
        f"the first paragraph of 'What it is' is {first!r}. It must say what this is, who it is "
        f"for and what it costs, in plain sentences"
    )


def test_the_readme_is_short_enough_to_scan():
    lines = len(_readme().splitlines())
    assert lines <= README_MAX_LINES, (
        f"README.md has {lines} lines; the cap is {README_MAX_LINES}. Move detail to a guide "
        f"page and link it"
    )


def test_the_readme_is_written_in_short_sentences():
    sentences = _sentences(_readme())
    assert len(sentences) >= 5, f"only {len(sentences)} sentences were read: the scan may be vacuous"
    words = [len(sentence.split()) for sentence in sentences]
    average = sum(words) / len(words)
    assert average <= README_MAX_AVERAGE_WORDS, (
        f"README.md averages {average:.1f} words a sentence; the cap is {README_MAX_AVERAGE_WORDS}"
    )
    longest = max(sentences, key=lambda sentence: len(sentence.split()))
    assert len(longest.split()) <= README_MAX_SENTENCE_WORDS, (
        f"README.md has a sentence of {len(longest.split())} words (the cap is "
        f"{README_MAX_SENTENCE_WORDS}): {' '.join(longest.split()[:12])} ..."
    )

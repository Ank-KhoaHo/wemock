"""Tests of README.md's shape: it is the page a stranger decides on, and it is scanned, not read.

Four rules, each one something a project made from this template had to go back and fix:

* it keeps the sections a reader looks for before trusting a tool: Status, Limits,
  Alternatives and FAQ
* its first paragraph says what the thing is, before any badge, heading or instruction
* it stays short enough to scan
* its sentences stay short: the average, and the longest

The numbers are caps, not targets. Three well-liked READMEs measured 13, 15 and 20 words a
sentence on average, in 120 to 320 lines. Raise a cap on purpose, in this file, with the reason.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_SECTIONS = ("Status", "Limits", "Alternatives", "FAQ")
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


# ---------------------------------------------------------------- the README itself


def test_the_readme_keeps_the_sections_a_reader_looks_for():
    headings = _headings(_readme())
    missing = [section for section in REQUIRED_SECTIONS if section not in headings]
    assert missing == [], (
        f"README.md has no section called {missing}. Status says what was really tried, Limits "
        f"what it does not do, Alternatives when something else is the better choice, and the "
        f"FAQ answers what is asked first"
    )


def test_the_readme_says_what_it_is_before_anything_else():
    readme = _readme()
    opening = readme.split("\n## ", 1)[0]
    first = _first_paragraph(opening)
    assert len(first.split()) >= 6, (
        f"the README's first paragraph is {first!r}. Before the first heading it must say what "
        f"this is, who it is for and what it costs, in plain sentences"
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

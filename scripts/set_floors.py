"""Set the docs guard's floors from what this repo holds today.

tests/test_docs_integrity.py carries four floors. Each one makes a walk that scans nothing
fail, instead of reporting green having checked nothing. A floor is only useful while it sits
near the real count: one left at the size of a young repo lets most of an older one vanish
without a word.

    python scripts/set_floors.py            set each floor to three quarters of its real count
    python scripts/set_floors.py --check    print the counts and the floors; change nothing

Run it after a large addition. tests/test_guard_selftest.py fails when a floor falls under half
of its real count, and names this command.

THIS REPOSITORY HAS TWO STATES, and the helper measures what the one it runs in can see. With
the working half on disk it sets all four floors; the CI floor is then the number of links a
clone could resolve. Without it -- in any clone -- only MIN_MD_FILES and MIN_LINKS_CI can be
measured, and the other two are left as they are.

THE COUNTS COME FROM THE GUARD ITSELF, never from a second copy of its walks: a helper that
counted its own way could set a floor the guard then trips over, or one it can never reach.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
import test_docs_integrity as guard  # noqa: E402

FLOOR_NAMES = ("MIN_MD_FILES", "MIN_LINKS_LOCAL", "MIN_LINKS_CI", "MIN_ROWS")
GUARD_PATH = ROOT / "tests" / "test_docs_integrity.py"

_ASSIGNMENT_RE = re.compile(r"^(" + "|".join(FLOOR_NAMES) + r")\s*=\s*\d+")


def floor_for(count: int) -> int:
    """Three quarters of the count, rounded down, and never below 1."""
    return max(1, (count * 3) // 4)


def measure() -> dict[str, int]:
    """The real counts this state can see, keyed by the floor each one is behind."""
    counts = {"MIN_MD_FILES": guard._count_markdown_files()}
    if guard._local_mode():
        _, checked, _, clone_checked = guard._walk_markdown_links(count_for_a_clone=True)
        assert clone_checked is not None
        counts["MIN_LINKS_LOCAL"] = checked
        counts["MIN_LINKS_CI"] = clone_checked
        counts["MIN_ROWS"] = len(guard._backlog_rows())
    else:
        _, checked, _, _ = guard._walk_markdown_links()
        counts["MIN_LINKS_CI"] = checked
    return counts


def fits(floor: int, count: int) -> bool:
    """At or under the count, and not under half of it (tiny counts excepted)."""
    return floor <= count and (floor * 2 >= count or count <= 2)


def rewrite(source: str, floors: dict[str, int]) -> str:
    """The guard's source text with the given floors replaced, and nothing else changed.

    Each name given must be one of the four, and assigned exactly once at the start of a line.
    Whatever follows the number on that line -- a comment, the line ending -- is kept as it
    is. A guard this cannot read is refused rather than half-rewritten.
    """
    unknown = [name for name in floors if name not in FLOOR_NAMES]
    if unknown:
        raise SystemExit(f"set_floors: {', '.join(unknown)} is not a floor")

    seen: dict[str, int] = {name: 0 for name in floors}
    lines = []
    for line in source.splitlines(keepends=True):
        match = _ASSIGNMENT_RE.match(line)
        if match and match.group(1) in floors:
            name = match.group(1)
            seen[name] += 1
            line = f"{name} = {floors[name]}" + line[match.end():]
        lines.append(line)

    missing = [name for name, times in seen.items() if times == 0]
    if missing:
        raise SystemExit(f"set_floors: the guard does not assign {', '.join(missing)}")
    twice = [name for name, times in seen.items() if times > 1]
    if twice:
        raise SystemExit(f"set_floors: the guard assigns {', '.join(twice)} more than once")
    return "".join(lines)


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    check_only = "--check" in argv
    counts = measure()

    if check_only:
        floors = {name: getattr(guard, name) for name in counts}
    else:
        floors = {name: floor_for(count) for name, count in counts.items()}
        source = GUARD_PATH.read_text(encoding="utf-8")
        GUARD_PATH.write_text(rewrite(source, floors), encoding="utf-8", newline="\n")

    print(f"{'floor':<18} {'count':>6} {'floor':>6}")
    unfit = []
    for name in FLOOR_NAMES:
        if name not in counts:
            print(f"{name:<18} {'-':>6} {getattr(guard, name):>6}   not measurable in this state: left as it is")
            continue
        ok = fits(floors[name], counts[name])
        print(f"{name:<18} {counts[name]:>6} {floors[name]:>6}{'' if ok else '   <- does not fit'}")
        if not ok:
            unfit.append(name)

    if check_only and unfit:
        sys.exit(f"set_floors: {', '.join(unfit)} no longer fit this repo. "
                 f"Run: python scripts/set_floors.py")


if __name__ == "__main__":
    main()

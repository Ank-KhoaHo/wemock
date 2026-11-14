"""Zip the maintainer's working material into a folder outside the repository.

    python scripts/backup_working_half.py                 into a folder named _backups beside the repo
    python scripts/backup_working_half.py <folder>        into that folder

WHY THIS EXISTS. In a public repository the working material is gitignored on purpose, so it
is in no commit and no push. It exists on one disk, and one `git clean -fdx` removes all of
it, with no undo. This gives it a second copy.

WHEN TO RUN IT: after a batch of notes lands, and before any `git clean`.

WHAT IT DOES NOT DO. An archive on the same disk protects against a bad command, not against a
dead disk. Copy it somewhere else as well. And the archive holds the private words of
`.leak-patterns.local` and every working note: keep it wherever those may be kept, never in a
folder that is published or shared.
"""

import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# What the docs guard says must never be tracked (tests/test_docs_integrity.py holds that list,
# and a test keeps this one from falling behind it), plus the leak check's private words.
# A path ending in "/" is a folder, taken whole.
WORKING_MATERIAL = (
    "docs/",
    "CLAUDE.md",
    "AGENTS.md",
    "QUESTIONS.md",
    "DEVELOPMENT-CHECKLIST.md",
    "BACKLOG.html",
    ".superpowers/",
    ".leak-patterns.local",
)


def _tracked(root: Path) -> set[str]:
    """Every path git tracks. A git failure stops the backup: read as "nothing is tracked", it
    would quietly change which files are saved."""
    done = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if done.returncode != 0:
        raise SystemExit(f"backup: git could not list the tracked files in {root}: {done.stderr.strip()}")
    return {path for path in (done.stdout or "").split("\0") if path}


def working_files(root: Path) -> list[str]:
    """Every working file on disk, as repository-relative paths with `/`, sorted.

    A file git tracks is left out. If a working file is ever tracked, that is a leak for the
    docs guard to report, not something a backup should paper over.
    """
    root = Path(root)
    tracked = _tracked(root)
    found: set[str] = set()
    for entry in WORKING_MATERIAL:
        target = root / entry.rstrip("/")
        candidates = target.rglob("*") if entry.endswith("/") and target.is_dir() else [target]
        for path in candidates:
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                if relative not in tracked:
                    found.add(relative)
    return sorted(found)


def backup(root: Path, destination: Path) -> Path:
    """Write one archive into `destination` (created if needed) and return its path."""
    root, destination = Path(root), Path(destination)
    inside = destination.resolve() == root.resolve() or destination.resolve().is_relative_to(root.resolve())
    if inside:
        # Inside the repository it would be removed by the same `git clean` it is meant to
        # survive, and it would be one `git add -f` away from being published.
        raise SystemExit(f"backup: {destination} is inside the repository. Choose a folder outside it.")

    files = working_files(root)
    if not files:
        # An empty archive would look like a backup and hold nothing.
        raise SystemExit("backup: there is no working material on this disk to save.")

    destination.mkdir(parents=True, exist_ok=True)
    stem = f"{root.resolve().name}-working-half-{datetime.now():%Y-%m-%d-%H%M%S}"
    archive = destination / f"{stem}.zip"
    counter = 2
    while archive.exists():             # two backups in one second must both survive
        archive = destination / f"{stem}-{counter}.zip"
        counter += 1

    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as held:
        for relative in files:
            held.write(root / relative, arcname=relative)
    return archive


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    destination = Path(argv[0]) if argv else ROOT.parent / "_backups"
    archive = backup(ROOT, destination)
    with zipfile.ZipFile(archive) as held:
        count = len(held.namelist())
    print(f"Saved {count} working files to {archive} ({archive.stat().st_size:,} bytes).")
    print("It is on the same disk as the repository: copy it somewhere else too.")


if __name__ == "__main__":
    main()

"""Tests of scripts/backup_working_half.py: the one copy of the working material gets a second.

In a public repository the maintainer's working material is gitignored, so no push holds it.
It exists on one disk, and one `git clean -fdx` removes all of it. The script zips it into a
folder outside the repository.
"""

import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

import test_docs_integrity as guard

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import backup_working_half as backup  # noqa: E402

_GITIGNORE = "\n".join([
    "__pycache__/", "node_modules/", "/docs/", "/CLAUDE.md", "/AGENTS.md", "/QUESTIONS.md",
    "/DEVELOPMENT-CHECKLIST.md", "/BACKLOG.html", "/.leak-patterns.local", ".superpowers/", "",
])

_WORKING = {
    "CLAUDE.md": "rules\n",
    "QUESTIONS.md": "open questions\n",
    "BACKLOG.html": "<html></html>\n",
    "docs/adr/0001.md": "a decision\n",
    "docs/superpowers/specs/D900-x.md": "# D900\n",
    ".leak-patterns.local": "bluebird\n",
    ".superpowers/sdd/prompt.md": "a prompt\n",
}
_NOT_WORKING = {
    "README.md": "published\n",                 # tracked
    "scripts/tool.py": "print('published')\n",  # tracked
    "__pycache__/tool.cpython-312.pyc": "cache\n",   # ignored, and not working material
    "node_modules/pkg/index.js": "a dependency\n",   # ignored, and not working material
}


def _repo(folder: Path) -> Path:
    """A repository with published files committed, and the working half on disk, untracked."""
    root = folder / "widget-forge"
    for name, text in {**_WORKING, **_NOT_WORKING, ".gitignore": _GITIGNORE}.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")

    def git(*args):
        subprocess.run(["git", "-c", "user.name=Backup Test", "-c", "user.email=backup-test@example.com", *args],
                       cwd=root, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("commit", "-q", "-m", "Published half")
    return root


def test_only_the_working_material_is_listed(tmp_path):
    root = _repo(tmp_path)
    assert backup.working_files(root) == sorted(_WORKING)


def test_a_working_file_that_git_tracks_is_left_out(tmp_path):
    """If a working file is ever tracked, a backup is the wrong tool: the guard is what must fail."""
    root = _repo(tmp_path)
    subprocess.run(["git", "add", "-f", "CLAUDE.md"], cwd=root, check=True, capture_output=True)
    assert "CLAUDE.md" not in backup.working_files(root)


def test_the_archive_holds_exactly_those_files_byte_for_byte(tmp_path):
    root = _repo(tmp_path)
    destination = tmp_path / "backups"
    archive = backup.backup(root, destination)
    assert archive.parent == destination and archive.suffix == ".zip"
    assert archive.name.startswith("widget-forge-working-half-"), archive.name
    with zipfile.ZipFile(archive) as held:
        assert sorted(held.namelist()) == sorted(_WORKING)
        for name, text in _WORKING.items():
            assert held.read(name) == text.encode("utf-8"), f"{name} changed on its way into the archive"


def test_a_second_backup_does_not_replace_the_first(tmp_path):
    root = _repo(tmp_path)
    destination = tmp_path / "backups"
    first = backup.backup(root, destination)
    second = backup.backup(root, destination)
    assert first != second and first.exists() and second.exists()


def test_a_destination_inside_the_repository_is_refused(tmp_path):
    """A backup inside the repository is removed by the same `git clean` it is meant to
    survive, and is one `git add -f` away from being published."""
    root = _repo(tmp_path)
    for inside in (root / "backups", root / "docs" / "backups", root):
        with pytest.raises(SystemExit):
            backup.backup(root, inside)
    assert not (root / "backups").exists()


def test_nothing_to_back_up_is_an_error_not_an_empty_archive(tmp_path):
    root = _repo(tmp_path)
    for name in _WORKING:
        (root / name).unlink()
    destination = tmp_path / "backups"
    with pytest.raises(SystemExit):
        backup.backup(root, destination)
    assert not destination.exists() or list(destination.iterdir()) == []


def test_a_folder_git_cannot_read_is_refused(tmp_path):
    """Which files are saved depends on what git tracks. If git cannot say, the backup must
    stop, not carry on as if nothing were tracked."""
    plain = tmp_path / "not-a-repository"
    (plain / "docs").mkdir(parents=True)
    (plain / "docs" / "note.md").write_text("a note\n", encoding="utf-8", newline="\n")
    with pytest.raises(SystemExit):
        backup.working_files(plain)
    with pytest.raises(SystemExit):
        backup.backup(plain, tmp_path / "backups")
    assert not (tmp_path / "backups").exists()


def test_the_command_reports_what_it_saved(tmp_path, monkeypatch, capsys):
    root = _repo(tmp_path)
    monkeypatch.setattr(backup, "ROOT", root)
    destination = tmp_path / "backups"
    backup.main([str(destination)])
    out = capsys.readouterr().out
    assert str(len(_WORKING)) in out, "the report does not say how many files were saved"
    assert len(list(destination.glob("*.zip"))) == 1


def test_everything_the_guard_calls_working_material_is_backed_up():
    """The guard holds the list of what must never be tracked. Whatever is on that list is, by
    the same fact, in no push, so it must be in the backup."""
    missing = [path for path in guard.WORKING_MATERIAL if path not in backup.WORKING_MATERIAL]
    assert missing == [], f"never tracked, and never backed up: {missing}"

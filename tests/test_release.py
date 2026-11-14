"""Tests of the two scripts a release runs: scripts/release_notes.py and scripts/build_release.py.

.github/workflows/release.yml calls both when a version tag is pushed. The first refuses a tag
that VERSION and the changelog do not agree with, and takes the release's notes from the
changelog. The second builds what is attached: from the tag, and from nothing else.
"""

import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_release  # noqa: E402
import release_notes  # noqa: E402

CHANGELOG = "\n".join([
    "# Changelog",
    "",
    "A released block's heading is the version, then the date: `## 0.1.0 — 2026-01-31`.",
    "",
    "```",
    "## 9.9.9 — an example, not a release",
    "",
    "- Shown, not released.",
    "```",
    "",
    "## Unreleased",
    "",
    "- Not out yet.",
    "",
    "## 1.2.0 — 2026-03-01",
    "",
    "- Widgets can be forged in pairs.",
    "- A forge that runs dry now says so.",
    "",
    "## 1.1.0 — 2026-02-01",
    "",
    "- The first café forge.",
    "",
    "## 1.0.0 — 2026-01-01",
    "",
    "",
])


# ---------------------------------------------------------------- the tag


def test_a_tag_is_v_and_three_numbers():
    assert release_notes.version_of("v1.2.0") == "1.2.0"
    assert release_notes.version_of("v0.1.0") == "0.1.0"
    assert release_notes.version_of("v10.20.30") == "10.20.30"


@pytest.mark.parametrize("tag", ["1.2.0", "v1.2", "v1.2.0.1", "v1.2.0-rc1", "V1.2.0", "release", "",
                                 "v1.2.0\n", " v1.2.0", "vv1.2.0", "v١.٢.٣"])
def test_anything_else_is_not_a_tag(tag):
    with pytest.raises(ValueError):
        release_notes.version_of(tag)


# ---------------------------------------------------------------- the notes


def test_the_notes_are_the_changelog_block_of_that_version():
    assert release_notes.notes_for(CHANGELOG, "1.2.0") == (
        "- Widgets can be forged in pairs.\n- A forge that runs dry now says so.")
    assert release_notes.notes_for(CHANGELOG, "1.1.0") == "- The first café forge."


def test_a_version_the_changelog_does_not_have_has_no_notes():
    assert release_notes.notes_for(CHANGELOG, "3.0.0") is None
    assert release_notes.notes_for(CHANGELOG, "1.2") is None
    assert release_notes.notes_for(CHANGELOG, "9.9.9") is None, "a heading inside an example is not a release"


def test_a_block_with_nothing_under_it_has_empty_notes():
    assert release_notes.notes_for(CHANGELOG, "1.0.0") == ""


# ---------------------------------------------------------------- what stops a release


def test_a_tag_that_agrees_with_both_files_has_no_problem():
    assert release_notes.problems("v1.2.0", "1.2.0\n", CHANGELOG) == []


def test_a_malformed_tag_is_the_only_thing_reported():
    found = release_notes.problems("1.2.0", "1.2.0\n", CHANGELOG)
    assert len(found) == 1 and "1.2.0" in found[0], found


def test_a_version_file_that_says_another_number_stops_the_release():
    found = release_notes.problems("v1.2.0", "1.1.0\n", CHANGELOG)
    assert len(found) == 1 and "VERSION" in found[0] and "1.1.0" in found[0] and "1.2.0" in found[0], found


def test_a_changelog_without_that_version_stops_the_release():
    found = release_notes.problems("v3.0.0", "3.0.0\n", CHANGELOG)
    assert len(found) == 1 and "CHANGELOG.md" in found[0] and "3.0.0" in found[0], found


def test_a_block_that_says_nothing_stops_the_release():
    """The notes are what a user reads. A release with none says nothing changed."""
    only_the_first = CHANGELOG.split("## 1.2.0")[0].split("## Unreleased")[0] + "## 1.0.0 — 2026-01-01\n\n"
    found = release_notes.problems("v1.0.0", "1.0.0\n", only_the_first)
    assert len(found) == 1 and "1.0.0" in found[0], found


def test_an_older_version_cannot_be_released_over_a_newer_one():
    found = release_notes.problems("v1.1.0", "1.1.0\n", CHANGELOG)
    assert len(found) == 1 and "1.2.0" in found[0], found


def test_versions_are_compared_as_numbers():
    """As text, 1.9.0 comes after 1.10.0."""
    changelog = "# Changelog\n\n## 1.10.0 — 2026-05-01\n\n- Ten.\n\n## 1.9.0 — 2026-04-01\n\n- Nine.\n"
    assert release_notes.problems("v1.10.0", "1.10.0\n", changelog) == []
    found = release_notes.problems("v1.9.0", "1.9.0\n", changelog)
    assert len(found) == 1 and "1.10.0" in found[0], found


def test_every_problem_is_reported_not_only_the_first():
    found = release_notes.problems("v3.0.0", "2.0.0\n", CHANGELOG)
    assert len(found) == 2, found


# ---------------------------------------------------------------- the command


def _scratch_root(monkeypatch, folder: Path, version: str | None = "1.2.0\n", changelog: str | None = CHANGELOG) -> None:
    if version is not None:
        (folder / "VERSION").write_text(version, encoding="utf-8", newline="\n")
    if changelog is not None:
        (folder / "CHANGELOG.md").write_text(changelog, encoding="utf-8", newline="\n")
    monkeypatch.setattr(release_notes, "ROOT", folder)


def test_the_command_prints_the_notes(monkeypatch, tmp_path, capsys):
    _scratch_root(monkeypatch, tmp_path)
    assert release_notes.main(["v1.2.0"]) == 0
    assert capsys.readouterr().out == "- Widgets can be forged in pairs.\n- A forge that runs dry now says so.\n"


def test_the_command_writes_the_notes_where_it_is_told(monkeypatch, tmp_path):
    _scratch_root(monkeypatch, tmp_path, version="1.1.0\n",
                  changelog=CHANGELOG.replace("## 1.2.0 — 2026-03-01", "## Planned"))
    target = tmp_path / "out" / "notes.md"
    assert release_notes.main(["v1.1.0", "--out", str(target)]) == 0
    assert target.read_bytes() == "- The first café forge.\n".encode("utf-8"), "not UTF-8 with one LF at the end"


def test_notes_the_screen_cannot_show_do_not_fail_the_command(monkeypatch, tmp_path):
    """Notes are prose, with dashes and accents. A Windows console often cannot encode them,
    and a sound release must not fail for it."""
    import io
    _scratch_root(monkeypatch, tmp_path, version="1.1.0\n",
                  changelog=CHANGELOG.replace("## 1.2.0 — 2026-03-01", "## Planned"))
    screen = io.TextIOWrapper(io.BytesIO(), encoding="ascii", errors="strict", newline="\n")
    monkeypatch.setattr(sys, "stdout", screen)
    assert release_notes.main(["v1.1.0"]) == 0
    screen.flush()
    assert screen.buffer.getvalue() == b"- The first caf? forge.\n"


def test_a_problem_fails_the_command_and_writes_nothing(monkeypatch, tmp_path, capsys):
    _scratch_root(monkeypatch, tmp_path, version="1.1.0\n")
    target = tmp_path / "notes.md"
    assert release_notes.main(["v1.2.0", "--out", str(target)]) == 1
    assert "VERSION" in capsys.readouterr().out
    assert not target.exists(), "notes were written for a release that was refused"


def test_a_missing_file_is_a_problem_not_a_crash(monkeypatch, tmp_path, capsys):
    _scratch_root(monkeypatch, tmp_path, version=None)
    assert release_notes.main(["v1.2.0"]) == 1
    assert "VERSION" in capsys.readouterr().out
    (tmp_path / "VERSION").write_text("1.2.0\n", encoding="utf-8", newline="\n")
    (tmp_path / "CHANGELOG.md").unlink()
    assert release_notes.main(["v1.2.0"]) == 1
    assert "CHANGELOG.md" in capsys.readouterr().out


# ---------------------------------------------------------------- the build

_IDENTITY = ("-c", "user.name=Release Test", "-c", "user.email=release-test@example.com")
_AT_THE_TAG = {
    ".gitignore": "/docs/\n/dist/\n",
    "README.md": "as released\n",
    "VERSION": "1.2.0\n",
    "scripts/tool.py": "print('released')\n",
}


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *_IDENTITY, *args], cwd=repo, check=True, capture_output=True,
                   text=True, encoding="utf-8", errors="replace")


def _repo(folder: Path) -> Path:
    """A repository tagged v1.2.0, which then moved on: a later commit, an edit that is not
    committed, a file git has never seen, and working material that is gitignored."""
    repo = folder / "some-folder"
    for name, text in _AT_THE_TAG.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "Release 1.2.0")
    _git(repo, "tag", "v1.2.0")
    (repo / "later.txt").write_text("after the release\n", encoding="utf-8", newline="\n")
    _git(repo, "add", "later.txt")
    _git(repo, "commit", "-q", "-m", "Work after the release")
    (repo / "README.md").write_text("edited, not committed\n", encoding="utf-8", newline="\n")
    (repo / "scratch.txt").write_text("never added\n", encoding="utf-8", newline="\n")
    (repo / "docs").mkdir()
    (repo / "docs" / "plan.md").write_text("working material\n", encoding="utf-8", newline="\n")
    return repo


def _held(archive: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(archive) as held:
        return {name: held.read(name) for name in held.namelist() if not name.endswith("/")}


def test_the_archive_is_named_after_the_project_and_the_version():
    assert build_release.archive_name("widget-forge", "1.2.0") == "widget-forge-1.2.0-source.zip"


def test_the_project_name_is_the_one_init_wrote_else_the_folders(monkeypatch, tmp_path):
    """Init writes the repository's name into the script. Before that, the folder's name is
    the only one there is."""
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    assert build_release.project_name(tmp_path / "some-folder") == "widget-forge"
    monkeypatch.setattr(build_release, "PROJECT", "<" + "PROJECT_NAME" + ">")
    assert build_release.project_name(tmp_path / "some-folder") == "some-folder"


def test_the_build_holds_the_tracked_files_as_they_were_at_the_tag(monkeypatch, tmp_path):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    archive = build_release.build(repo, "v1.2.0")
    assert archive == repo / "dist" / "widget-forge-1.2.0-source.zip" and archive.is_file()
    held = _held(archive)
    assert sorted(held) == sorted(f"widget-forge-1.2.0/{name}" for name in _AT_THE_TAG), sorted(held)
    assert held["widget-forge-1.2.0/README.md"] == b"as released\n", "built from the working tree, not from the tag"


def test_dist_holds_exactly_what_this_build_made(monkeypatch, tmp_path):
    """The workflow attaches everything in dist/. A file left there by an earlier build would
    be attached to this release under this release's name."""
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    (repo / "dist" / "old").mkdir(parents=True)
    (repo / "dist" / "widget-forge-1.1.0-source.zip").write_bytes(b"stale")
    (repo / "dist" / "old" / "notes.txt").write_bytes(b"stale")
    build_release.build(repo, "v1.2.0")
    build_release.build(repo, "v1.2.0")
    assert sorted(path.name for path in (repo / "dist").iterdir()) == ["widget-forge-1.2.0-source.zip"]


def test_a_tag_that_does_not_exist_builds_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    with pytest.raises(SystemExit, match="v1.3.0"):
        build_release.build(repo, "v1.3.0")
    with pytest.raises(SystemExit):
        build_release.build(repo, "main")
    left = list((repo / "dist").iterdir()) if (repo / "dist").exists() else []
    assert left == [], f"a refused build left files behind: {left}"


def test_a_tag_git_has_and_a_release_cannot_use_builds_nothing(monkeypatch, tmp_path):
    """`v1.2.0-rc1` can be a git tag. It is not a version this project releases."""
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    _git(repo, "tag", "v1.2.0-rc1")
    with pytest.raises(SystemExit):
        build_release.build(repo, "v1.2.0-rc1")
    assert not (repo / "dist").exists()


def test_a_refused_build_leaves_the_last_good_one_where_it_was(monkeypatch, tmp_path):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    good = build_release.build(repo, "v1.2.0")
    before = good.read_bytes()
    with pytest.raises(SystemExit):
        build_release.build(repo, "v1.3.0")
    assert good.is_file() and good.read_bytes() == before, "a build that was refused removed the last good one"


def test_a_folder_git_cannot_read_builds_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    plain = tmp_path / "not-a-repository"
    plain.mkdir()
    with pytest.raises(SystemExit):
        build_release.build(plain, "v1.2.0")
    assert not (plain / "dist").exists() or list((plain / "dist").iterdir()) == []


# Stands in for `npm run zip`: writes the zip the bundler would, under the name it would use.
_FAKE_ZIP = "import pathlib, sys; p = pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'store build')"


def _fake_bundler(monkeypatch, makes: str | None, exit_code: int = 0) -> None:
    import sys as _sys
    if exit_code:
        command = [_sys.executable, "-c", f"import sys; print('zip broke'); sys.exit({exit_code})"]
    elif makes is None:
        command = [_sys.executable, "-c", "pass"]
    else:
        command = [_sys.executable, "-c", _FAKE_ZIP, makes]
    monkeypatch.setattr(build_release, "_zip_command", lambda: command)


def test_the_command_says_what_it_built(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    monkeypatch.setattr(build_release, "ROOT", repo)
    _fake_bundler(monkeypatch, ".output/widget-forge-1.2.0-chrome.zip")
    assert build_release.main(["v1.2.0"]) == 0
    out = capsys.readouterr().out
    assert "dist/widget-forge-1.2.0-source.zip" in out
    assert "dist/widget-forge-1.2.0-chrome.zip" in out


def test_the_store_build_is_copied_into_dist_beside_the_source(monkeypatch, tmp_path):
    """A store upload needs the built extension, and the release attaches all of dist/."""
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    _fake_bundler(monkeypatch, ".output/widget-forge-1.2.0-chrome.zip")
    build_release.build(repo, "v1.2.0")
    store = build_release.build_store(repo, "1.2.0")
    assert store == repo / "dist" / "widget-forge-1.2.0-chrome.zip"
    assert store.read_bytes() == b"store build"
    assert sorted(p.name for p in (repo / "dist").iterdir()) == [
        "widget-forge-1.2.0-chrome.zip", "widget-forge-1.2.0-source.zip"]


def test_a_store_zip_of_another_version_is_not_attached(monkeypatch, tmp_path):
    """The bundler names the zip from package.json. Another number there means package.json
    and the tag disagree, and that build must not go out under the tag's name."""
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    _fake_bundler(monkeypatch, ".output/widget-forge-1.1.0-chrome.zip")
    build_release.build(repo, "v1.2.0")
    with pytest.raises(SystemExit, match="package.json"):
        build_release.build_store(repo, "1.2.0")
    assert [p.name for p in (repo / "dist").iterdir()] == ["widget-forge-1.2.0-source.zip"]


def test_a_bundler_that_fails_stops_the_release(monkeypatch, tmp_path):
    monkeypatch.setattr(build_release, "PROJECT", "widget-forge")
    repo = _repo(tmp_path)
    _fake_bundler(monkeypatch, None, exit_code=3)
    with pytest.raises(SystemExit, match="zip failed"):
        build_release.build_store(repo, "1.2.0")

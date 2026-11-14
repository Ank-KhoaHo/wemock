"""Tests of scripts/extension_step.py: the gate's steps for a browser extension.

    python scripts/extension_step.py typecheck | build | checks | unit | browser

Four of the five start a Node tool. These tests replace it with a small script that plays
it: what it prints and how it exits is written in a file beside the project.

What the steps must never do is report a pass that is not one:

* a test runner that skipped a test, or left one "todo", exits 0
* a store build that asks for access to every site builds without a word
* the version is typed in three places, and nothing compares them
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import extension_step as step  # noqa: E402

# Stands in for npm and npx. Given the tool's name and its arguments, it reads what to print
# and how to exit from fake-node.json: {"<first argument that matters>": {"out": "...", "exit": 0}}
_FAKE_NODE = '''
import json, sys, time
from pathlib import Path

tool, args = sys.argv[1], sys.argv[2:]
key = "typecheck" if "typecheck" in args else "build" if "build" in args else "vitest" if "vitest" in args else "playwright"
plan = json.loads(Path("fake-node.json").read_text(encoding="utf-8")).get(key, {"out": "", "exit": 0})
print(tool, " ".join(args), flush=True)
if plan.get("hang"):
    for tick in range(600):
        Path("fake-node.beat").write_text(str(tick), encoding="utf-8")
        time.sleep(0.2)
print(plan["out"])
sys.exit(plan["exit"])
'''

MANIFEST = {
    "manifest_version": 3,
    "name": "Widget Forge",
    "version": "1.2.0",
    "permissions": ["storage", "activeTab"],
    "optional_host_permissions": ["<all_urls>"],
}


def _project(folder: Path, monkeypatch, *, plan: dict | None = None, manifest: dict | None = MANIFEST,
             package: dict | None = None, version: str | None = "1.2.0\n", config: str | None = "zip: { zipSources: false },\n") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    if package is None:
        package = {"name": "widget-forge", "version": "1.2.0"}
    (folder / "package.json").write_text(json.dumps(package), encoding="utf-8", newline="\n")
    if version is not None:
        (folder / "VERSION").write_text(version, encoding="utf-8", newline="\n")
    if config is not None:
        (folder / "wxt.config.ts").write_text("export default defineConfig({\n  " + config + "});\n",
                                              encoding="utf-8", newline="\n")
    if manifest is not None:
        built = folder / ".output" / "chrome-mv3"
        built.mkdir(parents=True)
        (built / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8", newline="\n")
    (folder / "fake-node.json").write_text(json.dumps(plan or {}), encoding="utf-8", newline="\n")
    fake = folder / "fake_node.py"
    fake.write_text(_FAKE_NODE, encoding="utf-8", newline="\n")
    monkeypatch.setattr(step, "ROOT", folder)
    monkeypatch.setattr(step, "tool", lambda name: [sys.executable, str(fake), name])
    return folder


# ---------------------------------------------------------------- the four steps that start Node


@pytest.mark.parametrize("name, words", [
    ("typecheck", "npm run --silent typecheck"),
    ("build", "npm run --silent build"),
    ("unit", "npx vitest run"),
    ("browser", "npx playwright test"),
])
def test_each_step_starts_its_own_command_and_shows_what_it_printed(monkeypatch, tmp_path, capsys, name, words):
    _project(tmp_path, monkeypatch)
    assert step.main([name]) == 0
    assert words in capsys.readouterr().out


def test_a_command_that_fails_fails_the_step_with_its_own_exit_code(monkeypatch, tmp_path, capsys):
    _project(tmp_path, monkeypatch, plan={"typecheck": {"out": "src/a.ts(3,1): error TS2322", "exit": 2}})
    assert step.main(["typecheck"]) == 2
    assert "error TS2322" in capsys.readouterr().out


@pytest.mark.parametrize("name, key, line", [
    ("unit", "vitest", " Tests  12 passed | 2 skipped (14)"),
    ("unit", "vitest", " Tests  12 passed | 1 todo (13)"),
    ("browser", "playwright", "  2 skipped\n  9 passed (12.3s)"),
])
def test_a_skipped_test_fails_the_step_though_the_runner_exits_0(monkeypatch, tmp_path, capsys, name, key, line):
    """A skip is an assertion that did not run, printed in the colour of one that did."""
    _project(tmp_path, monkeypatch, plan={key: {"out": line, "exit": 0}})
    assert step.main([name]) == 1
    last = capsys.readouterr().out.splitlines()[-1]
    assert last.startswith("FAIL") and ("skipped" in last or "todo" in last), last


def test_a_run_with_nothing_skipped_passes(monkeypatch, tmp_path):
    _project(tmp_path, monkeypatch, plan={"vitest": {"out": " Tests  14 passed (14)\n 0 skipped", "exit": 0}})
    assert step.main(["unit"]) == 0


def test_the_word_alone_is_not_a_skip():
    assert step.skipped("unit", "it skipped the cache") == ""
    assert step.skipped("unit", " Tests  12 passed | 2 skipped (14)") != ""
    assert step.skipped("unit", " Tests  12 passed | 1 todo (13)") != ""
    assert step.skipped("browser", "  1 todo item in the page") == "", "todo is a vitest word, not a playwright one"


def test_no_package_json_means_there_is_no_extension_yet(monkeypatch, tmp_path, capsys):
    """The pack was installed and the extension was not created. That is a failure with a
    sentence, not a stack trace and not a pass."""
    root = _project(tmp_path, monkeypatch)
    (root / "package.json").unlink()
    for name in ("typecheck", "build", "unit", "browser", "checks"):
        assert step.main([name]) == 1, name
        assert "package.json" in capsys.readouterr().out


def test_a_tool_that_is_not_installed_is_said_in_words(monkeypatch, tmp_path, capsys):
    """On Windows npm is `npm.cmd`, which only its full path starts. So the tool is looked
    up first, and one that is not there is a sentence, not a stack trace."""
    (tmp_path / "package.json").write_text('{"name": "widget-forge", "version": "1.2.0"}', encoding="utf-8", newline="\n")
    monkeypatch.setattr(step, "ROOT", tmp_path)
    monkeypatch.setattr(step.shutil, "which", lambda name: None)
    assert step.main(["typecheck"]) == 1
    assert "npm" in capsys.readouterr().out
    monkeypatch.setattr(step.shutil, "which", lambda name: f"C:/tools/{name}.cmd")
    assert step.tool("npx") == ["C:/tools/npx.cmd"]


def test_an_unknown_step_is_refused():
    with pytest.raises(SystemExit):
        step.main(["deploy"])
    with pytest.raises(SystemExit):
        step.main([])


# ---------------------------------------------------------------- what the store build asks for


def test_site_access_is_what_the_build_asks_for_at_install():
    assert step.site_access(MANIFEST) == []
    asked = step.site_access({**MANIFEST, "host_permissions": ["https://example.com/*"],
                              "content_scripts": [{"matches": ["<all_urls>"], "js": ["a.js"]},
                                                  {"matches": ["https://example.com/*"]}]})
    assert asked == ["<all_urls>", "https://example.com/*"], "sorted, each pattern once"


def test_optional_access_is_asked_for_later_and_does_not_count():
    assert step.site_access({"optional_host_permissions": ["<all_urls>"], "permissions": ["activeTab"]}) == []


def test_a_sound_build_has_no_problem(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch)
    assert step.check_problems(root) == []


def test_a_build_that_asks_for_a_site_is_a_problem_until_it_is_allowed_by_name(monkeypatch, tmp_path):
    """Access to sites at install is what a store reviews hardest, and what a user is warned
    about. It is allowed here by writing the pattern down, on purpose, with the reason."""
    root = _project(tmp_path, monkeypatch, manifest={**MANIFEST, "host_permissions": ["http://localhost/*", "<all_urls>"]})
    monkeypatch.setattr(step, "ALLOWED_SITE_ACCESS", ())   # this project allows some; start from none
    problems = step.check_problems(root)
    assert len(problems) == 1 and "<all_urls>" in problems[0] and "http://localhost/*" in problems[0], problems
    monkeypatch.setattr(step, "ALLOWED_SITE_ACCESS", ("http://localhost/*",))
    problems = step.check_problems(root)
    assert len(problems) == 1 and "<all_urls>" in problems[0] and "localhost" not in problems[0], problems
    monkeypatch.setattr(step, "ALLOWED_SITE_ACCESS", ("http://localhost/*", "<all_urls>"))
    assert step.check_problems(root) == []


def test_a_content_script_that_runs_on_every_site_is_site_access_too(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch, manifest={**MANIFEST, "content_scripts": [{"matches": ["<all_urls>"]}]})
    problems = step.check_problems(root)
    assert len(problems) == 1 and "<all_urls>" in problems[0]


def test_no_build_to_read_is_a_problem_not_a_pass(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch, manifest=None)
    problems = step.check_problems(root)
    assert len(problems) == 1 and "manifest.json" in problems[0] and "build" in problems[0]


def test_a_manifest_that_cannot_be_read_is_a_problem(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch)
    (root / ".output" / "chrome-mv3" / "manifest.json").write_text("{ not json", encoding="utf-8", newline="\n")
    problems = step.check_problems(root)
    assert len(problems) == 1 and "manifest.json" in problems[0]


# ---------------------------------------------------------------- one version, in three places


@pytest.mark.parametrize("where", ["package", "version", "manifest"])
def test_the_version_is_the_same_in_all_three_places(monkeypatch, tmp_path, where):
    """package.json, the VERSION file and the built manifest each hold the version, typed by
    hand. A store refuses an upload whose version it has seen; a user sees the wrong one."""
    root = _project(tmp_path, monkeypatch,
                    package={"name": "widget-forge", "version": "1.3.0" if where == "package" else "1.2.0"},
                    version="1.3.0\n" if where == "version" else "1.2.0\n",
                    manifest={**MANIFEST, "version": "1.3.0" if where == "manifest" else "1.2.0"})
    problems = step.check_problems(root)
    assert len(problems) == 1 and "1.2.0" in problems[0] and "1.3.0" in problems[0], problems


def test_a_missing_version_file_is_a_problem(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch, version=None)
    problems = step.check_problems(root)
    assert len(problems) == 1 and "VERSION" in problems[0]


# ---------------------------------------------------------------- the sources archive


def test_the_bundlers_own_sources_archive_must_be_switched_off(monkeypatch, tmp_path):
    """The bundler's archive of the sources packs the whole folder, ignored files included,
    and this repository keeps working material in ignored files. The archive a store
    reviewer gets is made from what git tracks."""
    root = _project(tmp_path, monkeypatch, config="zip: { zipSources: true },\n")
    problems = step.check_problems(root)
    assert len(problems) == 1 and "zipSources" in problems[0]
    root = _project(tmp_path / "unset", monkeypatch, config="srcDir: 'src',\n")
    problems = step.check_problems(root)
    assert len(problems) == 1 and "zipSources" in problems[0]
    (root / "wxt.config.ts").rename(root / "wxt.config.mjs")
    problems = step.check_problems(root)
    assert len(problems) == 1 and "wxt.config.mjs" in problems[0], "the same bundler, with its settings in a file of another kind"


def test_a_project_on_another_bundler_is_not_asked_about_it(monkeypatch, tmp_path):
    root = _project(tmp_path, monkeypatch, config=None)
    assert step.check_problems(root) == []


# ---------------------------------------------------------------- the checks step


def test_the_checks_step_prints_every_problem_and_fails(monkeypatch, tmp_path, capsys):
    _project(tmp_path, monkeypatch, version="1.3.0\n", manifest={**MANIFEST, "host_permissions": ["<all_urls>"]})
    assert step.main(["checks"]) == 1
    out = capsys.readouterr().out
    assert "<all_urls>" in out and "1.3.0" in out


def test_the_checks_step_passes_and_says_what_it_read(monkeypatch, tmp_path, capsys):
    _project(tmp_path, monkeypatch)
    assert step.main(["checks"]) == 0
    assert "1.2.0" in capsys.readouterr().out


# ---------------------------------------------------------------- a step stops what it started


def test_a_tool_that_never_returns_is_stopped_with_everything_it_started(monkeypatch, tmp_path, capsys):
    """The gate stops a step that outlives its limit, and only that one process. npm, the
    tool npm started and the browsers the tests opened would be left running. So the step
    has a shorter limit of its own, and stops the whole tree, by process ID."""
    import time
    root = _project(tmp_path, monkeypatch, plan={"playwright": {"out": "", "exit": 0, "hang": True}})
    monkeypatch.setitem(step.LIMITS, "browser", 2)
    started = time.monotonic()
    assert step.main(["browser"]) == 1
    assert time.monotonic() - started < 30, "the step waited far past its time limit"
    assert "time limit" in capsys.readouterr().out
    beat = root / "fake-node.beat"
    before = beat.read_text(encoding="utf-8")
    time.sleep(1.0)
    assert beat.read_text(encoding="utf-8") == before, "the tool that hung is still running"


def test_each_step_gives_up_before_the_gate_does():
    """If the gate stopped the step first, nothing would stop what the step had started."""
    import re
    gate = ROOT / "scripts" / "check.py"                 # in a project
    shell_gate = ROOT / "scripts" / "check.sh"
    if not gate.is_file() and shell_gate.is_file():
        # This project's gate is still the shell script, which has no time limit of its own:
        # the step's limit is the only one, so it always comes first. What can go wrong here is
        # a step the shell gate starts directly, outside this script and its limit.
        text = shell_gate.read_text(encoding="utf-8")
        called = set(re.findall(r"scripts/extension_step\.py (\w+)", text))
        assert {"typecheck", "build", "checks", "unit", "browser"} <= called, called
        for direct in ("npx vitest", "npx playwright", "npm run"):
            assert direct not in text, f"the shell gate starts {direct!r} itself, outside the step's time limit"
        return
    fragment = ROOT.parent / "gate-steps.txt"            # where the pack lies, in the template
    text = (gate if gate.is_file() else fragment).read_text(encoding="utf-8")
    limits = dict(re.findall(r'"scripts/extension_step\.py", "(\w+)"\], timeout=(\d+)', text))
    assert set(limits) == {"typecheck", "build", "checks", "unit", "browser"}, limits
    for name, own in step.LIMITS.items():
        assert own < int(limits[name]), f"{name}: the step's own limit ({own} s) is not below the gate's ({limits[name]} s)"


def test_the_script_never_stops_a_process_by_name():
    """Another project's tests may be running in the same kind of browser, on the same machine."""
    source = (ROOT / "scripts" / "extension_step.py").read_text(encoding="utf-8")
    for by_name in ("/IM", "killall", "pkill", "Stop-Process -Name"):
        assert by_name not in source, f"the script stops processes by name ({by_name})"

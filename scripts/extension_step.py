"""The gate's steps for a browser extension. One word says which.

    python scripts/extension_step.py typecheck     npm run --silent typecheck
    python scripts/extension_step.py build         npm run --silent build
    python scripts/extension_step.py checks        reads what the build wrote; starts nothing
    python scripts/extension_step.py unit          npx vitest run
    python scripts/extension_step.py browser       npx playwright test

scripts/check.py runs these five, in that order, after the tests. The build comes before
the checks and the tests because both read what it wrote.

WHAT THE STEPS MUST NEVER DO IS REPORT A PASS THAT IS NOT ONE. Three ways it happens:

1. A SKIPPED TEST. A test runner that skipped a test, or left one "todo", exits 0. A skip is
   an assertion that did not run, printed in the colour of one that did. So the output of
   the two test steps is read for a count of skipped tests, whatever the exit code says.
2. SITE ACCESS AT INSTALL. A build that asks for every site builds without a word. It is
   what a store reviews hardest and what a user is warned about. So `checks` reads the built
   manifest, and fails on any site asked for at install that ALLOWED_SITE_ACCESS does not name.
3. A VERSION THAT DIFFERS. The version is typed in package.json, in the VERSION file, and
   ends up in the built manifest. `checks` fails when the three are not the same.

EACH STEP STOPS WHAT IT STARTED. The gate stops a step that outlives its time limit, and
only that one process: npm, the tool npm started, and the browsers the tests opened would
all be left running. So each step here has a shorter limit of its own, and when it passes,
the whole tree of processes this script started is stopped, by process ID. Never by name:
another project's tests may be running in the same kind of browser.
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Where the bundler writes the build the store gets. Change it for another bundler.
STORE_BUILD = ".output/chrome-mv3"

# Sites the store build may ask for at install. Empty: it asks for none.
# Each pattern written here is written on purpose, with the reason beside it.
# wemock works on a developer's own app, which almost always runs on this machine. Local
# addresses are granted at install so the first mock works with no extra click; every other
# site is asked for when the user turns wemock on for it (optional_host_permissions).
ALLOWED_SITE_ACCESS: tuple[str, ...] = (
    "http://localhost/*",
    "http://127.0.0.1/*",
    "https://localhost/*",
    "https://127.0.0.1/*",
)

COMMANDS: dict[str, list[str]] = {
    "typecheck": ["npm", "run", "--silent", "typecheck"],
    "build": ["npm", "run", "--silent", "build"],
    "unit": ["npx", "vitest", "run"],
    "browser": ["npx", "playwright", "test"],
}

# Seconds. Each is below the limit scripts/check.py gives the same step, so that this
# script is the one that stops, and it stops everything it started.
LIMITS: dict[str, int] = {"typecheck": 240, "build": 540, "unit": 540, "browser": 1700}

_SKIP_WORDS = {"unit": r"skipped|todo", "browser": r"skipped"}


def _say(text: str, end: str = "\n") -> None:
    """Print, whatever the screen can display.

    A tool's output holds characters a Windows console often cannot encode, and `print`
    then raises: the step would fail for a tick mark. Such a character costs one "?".
    """
    try:
        print(text, end=end, flush=True)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(text.encode(encoding, errors="replace").decode(encoding), end=end, flush=True)


def tool(name: str) -> list[str]:
    """The full path of npm or npx, as the start of a command.

    On Windows they are `npm.cmd` and `npx.cmd`, which only a full path starts. One that is
    not installed is a FileNotFoundError with a sentence, not a stack trace from deep inside.
    """
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"{name} was not found on PATH: install Node, then run this step again")
    return [path]


def skipped(step: str, output: str) -> str:
    """The text that shows a test did not run, or "" when every test ran.

    A count and then the word, the way both runners write it ("2 skipped", "1 todo"). The
    word alone, in ordinary output, is not a skip, and a count of 0 is not one either.
    """
    words = _SKIP_WORDS.get(step)
    if not words:
        return ""
    match = re.search(rf"\b([1-9][0-9]*\s+(?:{words}))\b", output)
    return match.group(1) if match else ""


def site_access(manifest: dict) -> list[str]:
    """Every site the build asks for AT INSTALL, sorted, each once.

    `host_permissions`, and the `matches` of each content script: both are granted the
    moment the extension is installed. `optional_host_permissions` is asked for later, when
    the user does something, and is not counted. `permissions` are not sites.
    """
    patterns: set[str] = set()
    for item in manifest.get("host_permissions") or []:
        if isinstance(item, str):
            patterns.add(item)
    for script in manifest.get("content_scripts") or []:
        if isinstance(script, dict):
            patterns.update(match for match in script.get("matches") or [] if isinstance(match, str))
    return sorted(patterns)


def _json_object(path: Path) -> dict | None:
    """What a JSON file holds, when it holds an object. None for anything else."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def check_problems(root: Path) -> list[str]:
    """Everything wrong with the store build, as sentences. Empty when it is sound.

    It reads what the build wrote and starts nothing. No build to read is a problem, not a
    pass: a check that found no file must not say the file is fine.
    """
    built = root / STORE_BUILD / "manifest.json"
    if not built.is_file():
        return [f"{STORE_BUILD}/manifest.json is not there: run the build step first"]
    manifest = _json_object(built)
    if manifest is None:
        return [f"{STORE_BUILD}/manifest.json cannot be read as JSON"]

    problems: list[str] = []

    asked = [pattern for pattern in site_access(manifest) if pattern not in ALLOWED_SITE_ACCESS]
    if asked:
        problems.append(
            f"the store build asks for site access at install: {', '.join(asked)}. Ask for it when the "
            "user clicks instead, or, if the extension cannot work without it, write the pattern in "
            "ALLOWED_SITE_ACCESS in scripts/extension_step.py with the reason beside it"
        )

    version_file = root / "VERSION"
    if not version_file.is_file():
        problems.append("the VERSION file is missing: it is one of the three places the version is written")
    else:
        package = _json_object(root / "package.json") or {}
        places = {"package.json": str(package.get("version", "")),
                  "VERSION": version_file.read_text(encoding="utf-8").strip(),
                  f"{STORE_BUILD}/manifest.json": str(manifest.get("version", ""))}
        if len(set(places.values())) != 1:
            problems.append("the version is not the same everywhere: "
                            + ", ".join(f"{place} says {value!r}" for place, value in places.items()))

    # One bundler's own archive of the sources packs the whole folder, ignored files
    # included, and a public repository keeps working material in ignored files. A project
    # on another bundler has no such setting and is not asked.
    for config in sorted(root.glob("wxt.config.*")):
        if not re.search(r"zipSources\s*:\s*false", config.read_text(encoding="utf-8")):
            problems.append(
                f"{config.name} does not set `zipSources: false`: the bundler's own archive of the "
                "sources would pack ignored files too. The archive made by scripts/build_release.py "
                "comes from what git tracks"
            )
    return problems


def _stop_tree(proc: subprocess.Popen) -> None:
    """Stop the process this script started and everything that one started, by process ID."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass  # it ended by itself between the limit and this line


def _run(command: list[str], limit: int) -> tuple[int | None, str]:
    """Run a tool, show its output as it arrives, and return (exit code, all of the output).

    The exit code is None when the limit passed and the tree was stopped. The output is
    shown while the tool runs: a build of ten minutes that says nothing looks hung.
    """
    # Elsewhere than Windows the tool gets a session of its own, so that _stop_tree can stop
    # that session and nothing outside it.
    own_session = {} if sys.platform == "win32" else {"start_new_session": True}
    proc = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1, **own_session)
    lines: list[str] = []

    def read() -> None:
        assert proc.stdout is not None
        with proc.stdout:
            for line in proc.stdout:
                lines.append(line)
                _say(line, end="")

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        proc.wait(timeout=limit)
        stopped = False
    except subprocess.TimeoutExpired:
        stopped = True
        _stop_tree(proc)
        proc.wait()
    reader.join(timeout=5.0)
    return (None if stopped else proc.returncode), "".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Run one step. Returns 0 only when it passed: the gate reads the exit code."""
    parser = argparse.ArgumentParser(description="The gate's steps for a browser extension.")
    parser.add_argument("step", choices=["typecheck", "build", "checks", "unit", "browser"])
    step = parser.parse_args(argv).step

    # The pack was installed and the extension was not created yet. That is a failure with
    # a sentence: a step that passed here would say an extension is sound.
    if not (ROOT / "package.json").is_file():
        _say("package.json is missing: there is no extension yet. Create it first, then run the gate again")
        return 1

    if step == "checks":
        problems = check_problems(ROOT)
        for problem in problems:
            _say(f"FAIL: {problem}")
        if problems:
            return 1
        manifest = _json_object(ROOT / STORE_BUILD / "manifest.json") or {}
        _say(f"ok: version {manifest.get('version', '')} in all three places; "
             f"{len(site_access(manifest))} sites asked for at install")
        return 0

    try:
        command = tool(COMMANDS[step][0]) + COMMANDS[step][1:]
    except FileNotFoundError as missing:
        _say(str(missing))
        return 1

    code, output = _run(command, LIMITS[step])
    if output and not output.endswith("\n"):
        _say("")
    if code is None:
        _say(f"FAIL: {step} ran past its time limit of {LIMITS[step]} s and was stopped, with everything it started")
        return 1
    if code != 0:
        return code
    not_run = skipped(step, output)
    if not_run:
        _say(f"FAIL: {not_run}. A test that did not run is not a test that passed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

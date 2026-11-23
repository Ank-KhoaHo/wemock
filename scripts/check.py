"""Run every check this repository has, in order. One command, here and in CI.

    python scripts/check.py           run every step; exit 0 only when all of them pass
    python scripts/check.py --list    print the steps and run nothing

An unknown argument stops the gate with exit code 2.

A contributor runs this before a commit. .github/workflows/ci.yml runs this same script and no
check of its own, so "it passes here" and "it passes in CI" mean the same steps. Passing here
is still not passing there: CI runs on another operating system.

IT IS PYTHON, NOT A SHELL SCRIPT, ON PURPOSE:

1. On Windows the word `bash` starts a different shell depending on where it is typed
   (Git Bash, WSL, MSYS2, Cygwin), and each sees different paths and tools.
2. The shell's `timeout` on Windows is another program entirely, which waits for a key press.

`subprocess` gives one behaviour everywhere, and a time limit that is the same everywhere.

A PROJECT ADDS ITS OWN CHECKS TO `STEPS`, below. Nothing else needs to change for CI to run them.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Set in the environment of every step. See main() for what it prevents.
RUNNING = "LOCAL_GATE_RUNNING"

# A step that takes more than this share of its time limit is said to be near its limit, on
# its own line and again at the end, so a person notices before a busy day stops the step.
NEAR_LIMIT = 0.8

# The seconds a step's cleanup command may take before it is stopped.
CLEANUP_LIMIT = 60


@dataclass
class Step:
    """One check: a name a person recognises, a command, and a time limit in seconds.

    The command is a list of arguments, never one shell string: no quoting rules, no pipe, and
    nothing that could cut the output down to its last lines.

    Every step has a time limit. A process that hangs -- a test waiting on input, a tool that
    never quits after an error -- would otherwise hang the gate, and in CI that reads as a
    job still running rather than a failure.

    cleanup is a command that removes what the step starts outside its own processes: a
    container, by its name. A container is not a child process, so stopping the step never
    reaches it. See run_step for when the command runs.
    """

    name: str
    command: list[str]
    timeout: int = 600
    cleanup: list[str] | None = None


@dataclass
class StepResult:
    """What one step did: whether it passed, why not, and everything it printed."""

    ok: bool
    reason: str
    output: str
    seconds: float = 0.0


# `sys.executable`, never the bare word `python`: the gate must test with the interpreter
# that is running it, not whichever one happens to be first on PATH.
#
# `-rfEs` makes pytest end with one line for each test that failed, errored or was skipped.
# `-rs` alone would REPLACE that list with the skipped tests only: a run would say
# "1 failed" and never name the test.
STEPS: list[Step] = [
    Step(
        name="tests",
        command=[sys.executable, "-m", "pytest", "-q", "-rfEs", "tests"],
        timeout=600,
    ),
    # A browser extension. Each step starts one tool, and a skipped test fails it. The build
    # comes before the checks and the tests: both read what the build wrote.
    Step(name="typecheck", command=[sys.executable, "scripts/extension_step.py", "typecheck"], timeout=300),
    Step(name="build", command=[sys.executable, "scripts/extension_step.py", "build"], timeout=600),
    Step(name="extension checks", command=[sys.executable, "scripts/extension_step.py", "checks"], timeout=60),
    Step(name="unit tests", command=[sys.executable, "scripts/extension_step.py", "unit"], timeout=600),
    Step(name="browser tests", command=[sys.executable, "scripts/extension_step.py", "browser"], timeout=1800),
]


def steps_for(form: str) -> list[Step]:
    """The steps of one form of the gate. This gate has one form, "whole". main() asks here, once.

    THE ONE PLACE main() GETS ITS STEPS. A project that builds its steps elsewhere, or adds
    a form of its own, changes this function and nothing in main(). The gate's tests replace
    it, so no test can start a real step: where a test replaced the list alone and the steps
    came from somewhere else, the real gate ran from inside the tests.

    A PROJECT WITH STEPS OF ITS OWN. A flag of the project's own changes the steps this
    function gave, and never builds its own: steps built past this function are steps no
    test replaces. A list is built once, when the module loads, never on each call: a
    builder that asks a tool something would start a process each time main() asks.
    """
    if form == "whole":
        return STEPS
    raise ValueError(f"check: no such form of the gate: {form}")


# A SKIPPED TEST FAILS THE GATE, even when the command exits 0. A skip is an assertion that
# did not run, reported in the same colour as one that did, and a suite can skip its way to
# green.
#
# It looks for skips in seven shapes across tools:
#   1. A count then the word: pytest and most others ("7 passed, 2 skipped in 0.31s").
#      Vitest and Playwright print `N skipped` too, and this shape reads them.
#   2. A whole line starting with ℹ: node --test on screen ("ℹ skipped 1", and "ℹ todo 1"
#      for a test that is still to do)
#   3. A whole line starting with #: node --test in CI ("# skipped 1", and "# todo 1")
#   4. The word, a colon, then count: .NET ("skipped: 2", "Skipped:     2")
#   5. The word, an equals sign, then count: unittest ("OK (skipped=3)")
#   6. A count then `todo`: Vitest, for a test that is named and not written
#      ("Tests  1 passed | 1 todo (2)")
#   7. pytest's own line for a skipped test, when no summary follows it
#      ("SKIPPED [1] test_x.py:6: not today")
#
# Node's `todo` lines and each of the last two ended with exit code 0 in a real run: a
# test that did not run.
#
# A count and its word are always read on one line (between them only spaces and tabs, never a
# line break), so a count ending one line and the word starting the next (such as a clean .NET
# summary ending with "succeeded: 307" and starting the next with "skipped: 0") does not read
# as a skip.
#
# A number before the word is its count only when no colon follows the word. A build log puts
# its own time before each line: Docker writes "#13 34.28   skipped: 0" for a clean .NET run,
# and read count first that is "28 skipped". With a colon the count is the number after it.
_SKIP_LINE_SHAPES = re.compile(r"^[ \t]*([ℹ#][ \t]+(?:skipped|todo)[ \t]+(\d+))[ \t]*$")
_SKIP_COUNT_FIRST = re.compile(r"\b(\d+)[ \t]+skipped\b(?![ \t]*:)")
_SKIP_COLON = re.compile(r"\bskipped[ \t]*:[ \t]*(\d+)\b", re.IGNORECASE)
_SKIP_EQUALS = re.compile(r"\bskipped[ \t]*=[ \t]*(\d+)\b", re.IGNORECASE)
_SKIP_TODO = re.compile(r"\b(\d+)[ \t]+todo\b(?![ \t]*:)")
_SKIP_PYTEST_LINE = re.compile(r"\bSKIPPED \[(\d+)\]")


def _skipped(output: str) -> str:
    """The text that shows a test was skipped, or "" when none was."""
    for line in output.splitlines():
        line_match = _SKIP_LINE_SHAPES.match(line)
        if line_match:
            if int(line_match.group(2)) > 0:
                return line_match.group(1)
            continue
        matches: list[tuple[int, str, int]] = []
        for m in _SKIP_COUNT_FIRST.finditer(line):
            matches.append((m.start(), m.group(0), int(m.group(1))))
        for m in _SKIP_COLON.finditer(line):
            matches.append((m.start(), m.group(0), int(m.group(1))))
        for m in _SKIP_EQUALS.finditer(line):
            matches.append((m.start(), m.group(0), int(m.group(1))))
        for m in _SKIP_TODO.finditer(line):
            matches.append((m.start(), m.group(0), int(m.group(1))))
        for m in _SKIP_PYTEST_LINE.finditer(line):
            matches.append((m.start(), m.group(0), int(m.group(1))))
        matches.sort(key=lambda item: item[0])
        for _, text, count in matches:
            if count > 0:
                return text
    return ""


def _show(line: str) -> None:
    """Write one line of a step's output to the screen, whatever the screen can display.

    A Windows console often cannot encode a character the step printed. That must cost one
    "?" on screen and nothing else: if the write raised instead, the thread reading the step's
    output would stop, the step would block on a full pipe, and the gate would sit until the
    time limit with nothing to say why.
    """
    try:
        sys.stdout.write(line)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        sys.stdout.write(line.encode(encoding, errors="replace").decode(encoding))
    sys.stdout.flush()


def _stop_tree(proc: subprocess.Popen) -> None:
    """Stop a step and every process it started, so none is left running on the machine.

    Stopping the step's own process is not enough: a browser test that hangs leaves its
    browser behind, and a browser left running has locked a Windows account before. On
    Windows `taskkill /T` follows the links from parent to child; elsewhere the step runs in
    a session of its own (see run_step), and the whole group is stopped.

    ITS LIMIT: on Windows a process whose parent has already gone is outside the tree, and
    is not found. It never raises: the step's own process is stopped whatever else failed.
    """
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
                timeout=30,     # a stop that hangs must not hang the gate in its turn
            )
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass

    try:
        proc.kill()
    except OSError:
        pass


def _run_cleanup(step: Step, env: dict[str, str], own_session: dict) -> None:
    """Run a step's cleanup command, from the repository root and with the step's environment.

    WHY IT EXISTS. `docker run` asks a service for a container, so the container is no child
    of the step: _stop_tree() ends the docker client, and the container runs on. A step that
    starts one gives the command that removes it by name.

    IT NEVER RAISES, AND IT NEVER CHANGES THE STEP'S RESULT. `docker rm -f` of a name that
    is not there exits 0 and says nothing; a tool that ends with an error there changes
    nothing, because the step's own exit code is the one that counts. A cleanup that failed,
    could not start, or ran past CLEANUP_LIMIT is one line on the screen. What it printed is
    shown only when it failed, and is never added to the step's own output, where a number in
    it could be read as a skipped test.
    """
    assert step.cleanup
    limit = CLEANUP_LIMIT       # read here, not when the module loads: a project may set it
    try:
        proc = subprocess.Popen(
            step.cleanup,
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            **own_session,
        )
    except OSError as exc:
        print(f"-- {step.name}: its cleanup could not start: {exc}", flush=True)
        return

    try:
        output, _ = proc.communicate(timeout=limit)
    except subprocess.TimeoutExpired:
        # A cleanup that waits on a service which is down would hang the gate, as a step would.
        _stop_tree(proc)
        print(f"-- {step.name}: its cleanup passed its limit of {limit} s, and was stopped", flush=True)
        try:
            proc.communicate(timeout=5.0)   # a process left outside the tree may hold the pipe
        except (subprocess.TimeoutExpired, OSError, ValueError):
            pass
        return

    if proc.returncode != 0:
        print(f"-- {step.name}: its cleanup ended with exit code {proc.returncode}", flush=True)
        for line in output.splitlines():
            _show(line + "\n")


def run_step(step: Step) -> StepResult:
    """Run one step from the repository root. Show its output as it arrives, and keep all of it.

    NEVER THE LAST LINES ONLY. The line that explains a failure is often not the last one: a
    parse error is printed first and a summary last. So nothing here pipes, cuts or tails; the
    whole output is shown while the step runs, and returned in full.

    A STEP'S CLEANUP RUNS BEFORE THE STEP, for what an earlier run left behind, and again
    when the step is stopped at its limit or by hand. It does not run after a step that
    ended by itself: such a step has removed what it started, or its command says to.
    """
    # Python children write UTF-8 to the pipe, whatever the console's own code page is; the
    # gate decodes UTF-8. Left to the locale, a child's "—" arrives as a byte this cannot read.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", RUNNING: "1"}
    popen_kwargs = {"start_new_session": True} if sys.platform != "win32" else {}

    if step.cleanup:
        _run_cleanup(step, env, popen_kwargs)

    start_time = time.monotonic()
    try:
        proc = subprocess.Popen(
            step.command,
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,   # one stream: errors stay next to what caused them
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **popen_kwargs,
        )
    except OSError as exc:
        return StepResult(ok=False, reason=f"could not start: {exc}", output="")

    lines: list[str] = []

    def read() -> None:
        assert proc.stdout is not None
        with proc.stdout:
            for line in proc.stdout:
                lines.append(line)      # kept first, so nothing shown can lose it
                _show(line)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()

    timed_out = False
    try:
        proc.wait(timeout=step.timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        # Everything the step started, not the step's own process alone: see _stop_tree().
        _stop_tree(proc)
        proc.wait()
        if step.cleanup:
            _run_cleanup(step, env, popen_kwargs)
    except KeyboardInterrupt:
        # Ctrl+C. Off Windows the step is in a session of its own and never gets the signal
        # itself, so the gate stops what the step started before it passes the signal on.
        _stop_tree(proc)
        if step.cleanup:
            _run_cleanup(step, env, popen_kwargs)
        raise

    # A process whose parent had already gone is outside the tree, and may still hold the pipe
    # open, which is why the join below has a limit of its own.
    reader.join(timeout=5.0)
    elapsed = time.monotonic() - start_time
    output = "".join(lines)

    if timed_out:
        return StepResult(False, f"timed out after {step.timeout} s", output, seconds=elapsed)
    if proc.returncode != 0:
        return StepResult(False, f"exit code {proc.returncode}", output, seconds=elapsed)
    skipped = _skipped(output)
    if skipped:
        # "The output above", not "the lines marked SKIPPED": that is pytest's word, and the
        # skip may be node's, .NET's or unittest's.
        return StepResult(False, f"a test was skipped ({skipped}); the output above names it", output, seconds=elapsed)
    return StepResult(True, "", output, seconds=elapsed)


def run(steps: list[Step]) -> int:
    """Run the steps in order and stop at the first that fails. 0 only when every step passed.

    A gate with no steps returns 1: it checked nothing, and must not say that it passed.

    A step that used more than NEAR_LIMIT of its time limit is said to, on its own line of
    seconds and again after the last step, where a person looks: a step once ran at 83 % of
    its limit on a busy day, and nothing said that the next such day would stop it.
    """
    if not steps:
        print("check: no steps to run, so nothing was checked.", flush=True)
        return 1

    near_limit: list[str] = []
    for position, step in enumerate(steps, start=1):
        print(f"\n== {position}/{len(steps)}  {step.name}", flush=True)
        result = run_step(step)
        if result.seconds > NEAR_LIMIT * step.timeout:
            # The whole percent, rounded down, from the seconds as measured.
            percent = int(result.seconds * 100 / step.timeout)
            print(f"-- {step.name}: {result.seconds:.1f} s, {percent} % of its limit of {step.timeout} s", flush=True)
            near_limit.append(f"{step.name} ({percent} % of {step.timeout} s)")
        else:
            print(f"-- {step.name}: {result.seconds:.1f} s", flush=True)
        if not result.ok:
            print(f"\nFAILED at step {position}, {step.name}: {result.reason}", flush=True)
            return 1

    print("\nAll local checks passed.", flush=True)
    if near_limit:
        print(f"Near its limit: {', '.join(near_limit)}.", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    for arg in argv:
        if arg != "--list":
            print(f"check: unknown argument {arg}. It takes --list.", flush=True)
            return 2
    # Asked once, here, and nowhere else: see steps_for().
    steps = steps_for("whole")
    if "--list" in argv:
        for position, step in enumerate(steps, start=1):
            cleanup = f"  [cleanup: {' '.join(step.cleanup)}]" if step.cleanup else ""
            print(f"{position}. {step.name}  ({step.timeout} s)  {' '.join(step.command)}{cleanup}")
        return 0
    # THE GATE NEVER RUNS INSIDE ITSELF. Its first step runs the tests; a test (or a step) that
    # started the gate would start the tests again, which start the gate again, without end.
    # It happened once, and left 133 processes behind before anyone looked. Every step is run
    # with this variable set, so a second gate underneath sees it and refuses.
    if os.environ.get(RUNNING):
        print("check: the gate is already running in a parent process, and will not start "
              "inside itself. A test or a step must never run scripts/check.py.", flush=True)
        return 1
    return run(steps)


if __name__ == "__main__":
    sys.exit(main())

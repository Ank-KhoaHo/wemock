"""Run every check this repository has, in order. One command, here and in CI.

    python scripts/check.py           run every step; exit 0 only when all of them pass
    python scripts/check.py --list    print the steps and run nothing

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
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Set in the environment of every step. See main() for what it prevents.
RUNNING = "LOCAL_GATE_RUNNING"


@dataclass
class Step:
    """One check: a name a person recognises, a command, and a time limit in seconds.

    The command is a list of arguments, never one shell string: no quoting rules, no pipe, and
    nothing that could cut the output down to its last lines.

    Every step has a time limit. A process that hangs -- a test waiting on input, a tool that
    never quits after an error -- would otherwise hang the gate, and in CI that reads as a
    job still running rather than a failure.
    """

    name: str
    command: list[str]
    timeout: int = 600


@dataclass
class StepResult:
    """What one step did: whether it passed, why not, and everything it printed."""

    ok: bool
    reason: str
    output: str


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


# A SKIPPED TEST FAILS THE GATE, even when the command exits 0. A skip is an assertion that
# did not run, reported in the same colour as one that did, and a suite can skip its way to
# green. The pattern is a count followed by the word, the way pytest's last line writes it
# ("4 passed, 1 skipped"); the word alone, in ordinary output, is not a skip.
_SKIP_PATTERN = re.compile(r"\b(\d+)\s+skipped\b")


def _skipped(output: str) -> str:
    """The text that shows a test was skipped, or "" when none was."""
    match = _SKIP_PATTERN.search(output)
    return match.group(0) if match and int(match.group(1)) > 0 else ""


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


def run_step(step: Step) -> StepResult:
    """Run one step from the repository root. Show its output as it arrives, and keep all of it.

    NEVER THE LAST LINES ONLY. The line that explains a failure is often not the last one: a
    parse error is printed first and a summary last. So nothing here pipes, cuts or tails; the
    whole output is shown while the step runs, and returned in full.
    """
    # Python children write UTF-8 to the pipe, whatever the console's own code page is; the
    # gate decodes UTF-8. Left to the locale, a child's "—" arrives as a byte this cannot read.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", RUNNING: "1"}
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
        # This stops the step's own process. A step that starts other processes must stop
        # them itself; one left running keeps the pipe open, which is why the join below
        # has a limit of its own.
        proc.kill()
        proc.wait()
    reader.join(timeout=5.0)
    output = "".join(lines)

    if timed_out:
        return StepResult(False, f"timed out after {step.timeout} s", output)
    if proc.returncode != 0:
        return StepResult(False, f"exit code {proc.returncode}", output)
    skipped = _skipped(output)
    if skipped:
        return StepResult(False, f"a test was skipped ({skipped}); the lines marked SKIPPED say which", output)
    return StepResult(True, "", output)


def run(steps: list[Step]) -> int:
    """Run the steps in order and stop at the first that fails. 0 only when every step passed.

    A gate with no steps returns 1: it checked nothing, and must not say that it passed.
    """
    if not steps:
        print("check: no steps to run, so nothing was checked.", flush=True)
        return 1

    for position, step in enumerate(steps, start=1):
        print(f"\n== {position}/{len(steps)}  {step.name}", flush=True)
        result = run_step(step)
        if not result.ok:
            print(f"\nFAILED at step {position}, {step.name}: {result.reason}", flush=True)
            return 1

    print("\nAll local checks passed.", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--list" in argv:
        for position, step in enumerate(STEPS, start=1):
            print(f"{position}. {step.name}  ({step.timeout} s)  {' '.join(step.command)}")
        return 0
    # THE GATE NEVER RUNS INSIDE ITSELF. Its first step runs the tests; a test (or a step) that
    # started the gate would start the tests again, which start the gate again, without end.
    # It happened once, and left 133 processes behind before anyone looked. Every step is run
    # with this variable set, so a second gate underneath sees it and refuses.
    if os.environ.get(RUNNING):
        print("check: the gate is already running in a parent process, and will not start "
              "inside itself. A test or a step must never run scripts/check.py.", flush=True)
        return 1
    return run(STEPS)


if __name__ == "__main__":
    sys.exit(main())

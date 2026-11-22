"""Tests of scripts/check.py, the one script that runs every check.

A contributor runs it before a commit, and CI runs the same script, so "it passes here" and "it
passes in CI" mean the same steps. These tests drive the gate's machinery with tiny commands;
none of them runs the real gate, because the real gate runs this file.

What the gate must do, and each test below holds it to one of these:

* stop at the first step that fails, and say which
* treat a skipped test as a failure: a skip is an assertion that did not run
* give every step a time limit, so a hung process cannot hang the gate
* show a step's output as it arrives, in full, never the last few lines only
"""

import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check  # noqa: E402

PY = sys.executable


def _step(name: str, code: str, timeout: int = 30) -> "check.Step":
    return check.Step(name=name, command=[PY, "-c", code], timeout=timeout)


# ---------------------------------------------------------------- one step


def test_a_step_that_exits_zero_passes():
    result = check.run_step(_step("says hello", "print('hello from the step')"))
    assert result.ok
    assert "hello from the step" in result.output


def test_a_step_that_exits_non_zero_fails_and_says_so():
    result = check.run_step(_step("breaks", "import sys; print('about to fail'); sys.exit(3)"))
    assert not result.ok
    assert "3" in result.reason, f"the reason does not name the exit code: {result.reason!r}"
    assert "about to fail" in result.output


def test_a_skipped_test_fails_the_step_even_with_exit_zero():
    for summary in ("4 passed, 1 skipped in 0.10s", "====== 12 passed, 2 skipped, 1 warning in 3.2s ======"):
        result = check.run_step(_step("pytest with a skip", f"print({summary!r})"))
        assert not result.ok, f"a run that ended {summary!r} was accepted"
        assert "skip" in result.reason.lower()


def test_the_word_skipped_in_ordinary_output_is_not_a_skip():
    result = check.run_step(_step("talks about skipping", "print('nothing was skipped here'); print('5 passed in 0.1s')"))
    assert result.ok, result.reason


def test_a_step_that_hangs_is_stopped_at_its_time_limit():
    started = time.monotonic()
    result = check.run_step(_step("hangs", "import time; print('started', flush=True); time.sleep(60)", timeout=2))
    elapsed = time.monotonic() - started
    assert not result.ok
    assert "timed out" in result.reason.lower()
    assert elapsed < 15, f"the gate waited {elapsed:.0f} s for a step limited to 2 s"
    assert "started" in result.output, "output printed before the hang was lost"


def test_output_from_stderr_is_kept_too():
    result = check.run_step(_step("writes to stderr", "import sys; print('on stderr', file=sys.stderr)"))
    assert result.ok
    assert "on stderr" in result.output


def test_a_character_the_screen_cannot_show_does_not_stop_the_step(monkeypatch):
    """A Windows console in its default code page cannot encode an arrow. If writing it to the
    screen raised, the output reader would stop and the step would hang until its time limit."""
    import io

    narrow_screen = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
    monkeypatch.setattr(sys, "stdout", narrow_screen)
    result = check.run_step(_step("prints an arrow", r"print('before → after')", timeout=20))
    narrow_screen.flush()
    shown = narrow_screen.buffer.getvalue().decode("cp1252")
    monkeypatch.undo()

    assert result.ok, result.reason
    assert "before → after" in result.output, "the kept output lost the character"
    assert "before ? after" in shown, f"the screen got {shown!r}"


# ---------------------------------------------------------------- the whole run


def test_every_step_runs_in_order_when_all_pass(capsys):
    steps = [_step("first", "print('one')"), _step("second", "print('two')")]
    assert check.run(steps) == 0
    out = capsys.readouterr().out
    assert out.index("first") < out.index("one") < out.index("second") < out.index("two")
    assert "All local checks passed." in out


def test_the_run_stops_at_the_first_failing_step(tmp_path, capsys):
    marker = tmp_path / "third-step-ran.txt"
    steps = [
        _step("first", "print('one')"),
        _step("second breaks", "import sys; sys.exit(1)"),
        _step("third", f"open({str(marker)!r}, 'w').close()"),
    ]
    assert check.run(steps) == 1
    out = capsys.readouterr().out
    assert not marker.exists(), "a step ran after an earlier step had failed"
    assert "second breaks" in out
    assert "All local checks passed." not in out


def test_an_empty_list_of_steps_is_a_failure(capsys):
    assert check.run([]) != 0, "a gate with no steps reported success having checked nothing"


# ---------------------------------------------------------------- the steps this repo ships


def test_the_first_step_runs_this_repos_tests_with_pytest():
    assert check.STEPS, "the gate ships with no steps"
    first = check.STEPS[0].command
    assert first[0] == sys.executable, "run pytest with the interpreter running the gate, not whatever is on PATH"
    assert first[1:3] == ["-m", "pytest"]
    assert "tests" in first
    report = [arg for arg in first if arg.startswith("-r")]
    assert len(report) == 1 and all(letter in report[0] for letter in "fEs"), (
        f"pytest must end by naming every failed, errored and skipped test (-rfEs); it is given {report}"
    )


def test_no_step_is_a_shell_string_or_hides_output():
    for step in check.STEPS:
        assert isinstance(step.command, list), f"{step.name}: a command is a list of arguments, never one shell string"
        joined = " ".join(step.command)
        assert "|" not in joined and "tail" not in step.command, (
            f"{step.name}: output must not be piped or cut; the line that explains a failure is often not the last"
        )
        assert step.timeout > 0, f"{step.name}: every step needs a time limit"


def _marker_step(monkeypatch, tmp_path) -> Path:
    """Replace the real steps with one harmless step that leaves a file behind.

    The two tests below call `main()`. With the real steps in place, a bug in `main()` would
    run the whole suite from inside the suite, and that run would do the same, without end.
    """
    marker = tmp_path / "the-step-ran.txt"
    monkeypatch.setattr(check, "STEPS", [_step("leaves a marker", f"open({str(marker)!r}, 'w').close()")])
    return marker


def test_listing_the_steps_runs_nothing(monkeypatch, tmp_path, capsys):
    marker = _marker_step(monkeypatch, tmp_path)
    monkeypatch.delenv(check.RUNNING, raising=False)
    assert check.main(["--list"]) == 0
    assert "leaves a marker" in capsys.readouterr().out
    assert not marker.exists(), "--list ran a step"


def test_the_gate_refuses_to_run_inside_itself(monkeypatch, tmp_path, capsys):
    marker = _marker_step(monkeypatch, tmp_path)

    monkeypatch.setenv(check.RUNNING, "1")
    assert check.main([]) != 0, "the gate started underneath a gate that was already running"
    assert not marker.exists()
    assert "inside itself" in capsys.readouterr().out

    monkeypatch.delenv(check.RUNNING)
    assert check.main([]) == 0
    assert marker.exists(), "outside a running gate, main() must run the steps"


def test_every_step_is_told_the_gate_is_running():
    result = check.run_step(_step("reads its environment", f"import os; print(os.environ.get({check.RUNNING!r}))"))
    assert result.ok and result.output.strip() == "1", result.output


# ---------------------------------------------------------------- CI runs the same script


def _workflow_commands() -> list[str]:
    """Every line of ci.yml that is not a comment."""
    text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")]


def test_ci_runs_the_gate_and_no_check_of_its_own():
    workflow = ROOT / ".github" / "workflows" / "ci.yml"
    if not workflow.exists():
        return
    lines = _workflow_commands()
    assert any("python scripts/check.py" in line for line in lines), (
        "ci.yml does not run scripts/check.py, so CI and a local run can check different things"
    )
    own = [line for line in lines if re.search(r"\bpytest\b", line) and "pip install" not in line]
    assert own == [], (
        f"ci.yml runs pytest itself: {own}. Put the check in scripts/check.py, where a local run gets it too"
    )


def test_the_contributor_guide_names_the_gate():
    guide = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
    assert "python scripts/check.py" in guide, (
        "CONTRIBUTING.md does not say how to run every check: it is the first place a contributor looks"
    )


# ---------------------------------------------------------------- an argument it does not know


def test_an_argument_the_gate_does_not_know_stops_it(monkeypatch, tmp_path, capsys):
    """A mistyped argument ran the whole gate without a word: main() looked only for the one
    argument it knows. A typing mistake must not choose which checks run."""
    marker = _marker_step(monkeypatch, tmp_path)
    monkeypatch.delenv(check.RUNNING, raising=False)
    for argv, unknown in ((["--lsit"], "--lsit"), (["--list", "-x"], "-x"), (["tests"], "tests"),
                          (["--quick"], "--quick")):
        assert check.main(argv) == 2, f"{argv} was accepted"
        captured = capsys.readouterr()
        said = captured.out + captured.err
        assert unknown in said, f"the gate does not name the argument it refused: {said!r}"
        assert "--list" in said.replace(unknown, ""), f"it does not say which argument it takes: {said!r}"
        assert not marker.exists(), f"{argv} ran a step"
        assert "leaves a marker" not in said, f"{argv} listed the steps"


# ---------------------------------------------------------------- how long each step took


_SECONDS = re.compile(r"^-- (.+): (\d+\.\d) s$")


def test_each_step_ends_with_the_seconds_it_took(capsys):
    """A project timed its steps by hand, to find the slow one."""
    steps = [_step("first", "print('one')"), _step("naps", "import time; time.sleep(1.2); print('two')")]
    assert check.run(steps) == 0
    lines = capsys.readouterr().out.splitlines()
    took = {match.group(1): float(match.group(2)) for match in map(_SECONDS.match, lines) if match}
    assert set(took) == {"first", "naps"}, f"no line of seconds for each step, in the form `-- name: 1.2 s`: {lines}"
    assert took["naps"] >= 1.2, f"a step that slept 1.2 s is said to have taken {took['naps']} s"

    def at(start: str) -> int:
        return next(index for index, line in enumerate(lines) if line.startswith(start))

    order = [at("one"), at("-- first: "), at("== 2/2"), at("two"), at("-- naps: "), at("All local checks passed.")]
    assert order == sorted(order), f"a step's seconds do not follow its own output: {lines}"


def test_a_failing_step_says_how_long_it_ran_and_still_ends_on_the_failure(capsys):
    assert check.run([_step("breaks", "import sys; sys.exit(1)")]) == 1
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert lines[-1].startswith("FAILED at step 1, breaks"), lines[-1]
    assert _SECONDS.match(lines[-2]) and lines[-2].startswith("-- breaks: "), lines[-2]


def test_a_steps_result_carries_its_seconds():
    result = check.run_step(_step("naps", "import time; time.sleep(0.6)"))
    assert result.ok and 0.6 <= result.seconds < 30, f"0.6 s of sleep was measured as {result.seconds}"


# ---------------------------------------------------------------- every shape of a skip


def _printed(text: str) -> str:
    return f"print({text!r})"


# What each tool really prints at its end. The gate used to know pytest's line alone.
_REAL_SKIPS = {
    "node --test, as a person sees it": "ℹ tests 14\nℹ pass 13\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0",
    "node --test, as CI sees it": "# tests 14\n# pass 13\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0",
    ".NET, a summary on several lines":
        "Test run summary: Passed!\n  total: 309\n  failed: 0\n  succeeded: 307\n  skipped: 2\n  duration: 3s 471ms",
    ".NET, a summary on one line":
        "Test summary: total: 309, failed: 0, succeeded: 307, skipped: 2, duration: 21.4s",
    ".NET, the older summary":
        "Passed!  - Failed:     0, Passed:   307, Skipped:     2, Total:   309, Duration: 5 s - Tests.dll (net8.0)",
    "unittest": "Ran 12 tests in 0.004s\n\nOK (skipped=3)",
    "two suites in one step, the first with none": "3 passed, 0 skipped\n7 passed, 2 skipped in 0.31s",
}

_NO_SKIPS = {
    ".NET, a clean summary on several lines":
        "Test run summary: Passed!\n  total: 307\n  failed: 0\n  succeeded: 307\n  skipped: 0\n  duration: 3s 471ms",
    ".NET, a clean summary on one line":
        "Test summary: total: 307, failed: 0, succeeded: 307, skipped: 0, duration: 21.4s",
    ".NET, the older summary, clean":
        "Passed!  - Failed:     0, Passed:   307, Skipped:     0, Total:   307, Duration: 5 s - Tests.dll (net8.0)",
    "node --test, clean": "ℹ tests 14\nℹ pass 14\nℹ skipped 0\nℹ todo 0",
    "node --test in CI, clean": "# tests 14\n# pass 14\n# skipped 0\n# todo 0",
    "unittest, clean": "Ran 12 tests in 0.004s\n\nOK (skipped=0)",
    "a count that ends one line, and the word that starts the next":
        "written: 12\nskipped the cache, as asked\n5 passed in 0.1s",
    "the word and a number in ordinary output": "copy: skipped 3 that were already there\n5 passed in 0.1s",
}


def test_every_shape_of_a_skip_fails_the_step():
    """Measured on real output: four shapes were not seen at all, and a first count of none
    hid a real count after it, because one match was read."""
    for tool, output in _REAL_SKIPS.items():
        result = check.run_step(_step(tool, _printed(output)))
        assert not result.ok, f"{tool}: a run with a skipped test was accepted"
        assert result.reason.startswith("a test was skipped ("), f"{tool}: the reason does not say what happened: {result.reason}"
        assert "\n" not in result.reason, f"{tool}: the reason runs over a line break: {result.reason!r}"


def test_a_count_of_none_in_any_shape_is_not_a_skip():
    """A count is read on its own line. A clean .NET summary ends one line with a number and
    starts the next with the word, and that read as "307 skipped"."""
    for tool, output in _NO_SKIPS.items():
        result = check.run_step(_step(tool, _printed(output)))
        assert result.ok, f"{tool}: a clean run was refused: {result.reason}"


def test_a_number_before_the_label_is_not_its_count():
    """A build log puts its own time before each line: Docker writes "#13 34.28   skipped: 0"
    for a clean .NET run. Read count first, that is "28 skipped", and a gate that fails every
    clean run gets switched off. One project found it. The count is the number after the colon."""
    clean = check.run_step(_step("a build log, clean", _printed("#13 34.28   skipped: 0\n#13 34.29   duration: 3s")))
    assert clean.ok, f"a clean run inside a build log was refused: {clean.reason}"
    skipped = check.run_step(_step("a build log, one skip", _printed("#13 34.28   skipped: 2")))
    assert not skipped.ok, "a skipped test inside a build log was accepted"
    assert "skipped: 2" in skipped.reason and "28" not in skipped.reason, (
        f"the reason names the log's own time, not the count: {skipped.reason}")


# ---------------------------------------------------------------- a step is stopped with all it started


# The step: it starts a child, then hangs. The child writes one character ten times a second,
# so a test can see whether it is still alive without asking the system about a process ID.
# Both end by themselves, so a failing test cannot leave them on the machine for long.
_CHILD = """
import os, sys, time
beat = sys.argv[1]
with open(beat + '.pid', 'w') as out:
    out.write(str(os.getpid()))
end = time.monotonic() + 40
while time.monotonic() < end:
    with open(beat, 'a') as out:
        out.write('.')
    time.sleep(0.1)
"""

_PARENT = """
import os, subprocess, sys, time
with open(sys.argv[2] + '.parent', 'w') as out:
    out.write(str(os.getpid()))
subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2]])
print('started a child', flush=True)
time.sleep(40)
"""


def _hangs_with_a_child(beat: Path) -> list[str]:
    return [PY, "-c", _PARENT, _CHILD, str(beat)]


def _wait_for(path: Path, seconds: float = 20.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if path.exists() and path.read_text():
            return True
        time.sleep(0.05)
    return False


def _still_beating(beat: Path) -> bool:
    time.sleep(0.5)
    before = beat.stat().st_size
    time.sleep(1.0)
    return beat.stat().st_size != before


def _stop_leftovers(beat: Path) -> None:
    """Whatever the gate left running is stopped here, by its own process ID and no other."""
    for suffix in (".pid", ".parent"):
        try:
            os.kill(int(Path(str(beat) + suffix).read_text()), signal.SIGTERM)
        except (OSError, ValueError):
            pass


def test_a_step_past_its_limit_is_stopped_with_everything_it_started(tmp_path):
    """The gate stopped the step's own process and nothing below it. A browser test that hangs
    leaves its browser running, long after the gate has said that it failed."""
    beat = tmp_path / "beat.txt"
    started = time.monotonic()
    try:
        result = check.run_step(check.Step(name="hangs with a child", command=_hangs_with_a_child(beat), timeout=6))
        elapsed = time.monotonic() - started
        assert not result.ok and "timed out" in result.reason.lower()
        assert "started a child" in result.output
        assert _wait_for(Path(str(beat) + ".pid"), seconds=1), "the step's child never started: the test proved nothing"
        assert elapsed < 20, f"the gate waited {elapsed:.0f} s for a step limited to 6 s"
        assert not _still_beating(beat), "the step was stopped at its limit, and the process it had started is still running"
    finally:
        _stop_leftovers(beat)


def test_a_gate_stopped_by_hand_takes_the_steps_processes_with_it(tmp_path, monkeypatch):
    """Ctrl+C. A step in a session of its own does not get the signal itself, so the gate stops
    everything the step started, and then passes the interruption on."""
    beat = tmp_path / "beat.txt"
    command = _hangs_with_a_child(beat)
    interrupted = []

    class Interrupted(subprocess.Popen):
        """A Popen whose first wait, on the step alone, is cut short as by Ctrl+C."""

        def wait(self, timeout=None):
            if self.args == command and not interrupted:
                interrupted.append(True)
                assert _wait_for(Path(str(beat) + ".pid")), "the step's child never started"
                raise KeyboardInterrupt
            return super().wait(timeout)

    monkeypatch.setattr(check.subprocess, "Popen", Interrupted)
    try:
        with pytest.raises(KeyboardInterrupt):
            check.run_step(check.Step(name="interrupted", command=command, timeout=30))
        monkeypatch.undo()
        assert interrupted, "the gate never waited on the step"
        assert not _still_beating(beat), "the gate was interrupted, and the process its step had started is still running"
    finally:
        monkeypatch.undo()
        _stop_leftovers(beat)


def test_a_tree_stop_that_cannot_run_still_stops_the_step(monkeypatch):
    """The tree stop asks another program on Windows, and the system elsewhere. Neither may be
    there, or the process may be gone already. The step's own process is stopped all the same."""
    def cannot(*args, **kwargs):
        raise OSError("no such program")

    def gone(*args, **kwargs):
        raise ProcessLookupError("no such process group")

    monkeypatch.setattr(check.subprocess, "run", cannot)
    if hasattr(os, "killpg"):
        monkeypatch.setattr(check.os, "killpg", gone)
    started = time.monotonic()
    result = check.run_step(_step("hangs", "import time; print('started', flush=True); time.sleep(60)", timeout=2))
    assert not result.ok and "timed out" in result.reason.lower()
    assert time.monotonic() - started < 15

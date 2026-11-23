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


def _touch(path: Path) -> list[str]:
    """A command that leaves a file behind, so a test can see whether it ran."""
    return [PY, "-c", f"open({str(path)!r}, 'w').close()"]


# ---------------------------------------------------------------- no test starts a real step


def _the_gates_own() -> list:
    """What the gate itself runs."""
    steps_for = getattr(check, "steps_for", None)
    if steps_for is None:       # a gate that does not have the one function yet: its list
        return list(check.STEPS)
    return list(steps_for("whole"))


# Read once, before any test replaces anything: every step the gate really runs.
_REAL_STEPS = _the_gates_own()
_REAL_COMMANDS = [command for step in _REAL_STEPS
                  for command in (step.command, getattr(step, "cleanup", None)) if command]


@pytest.fixture(autouse=True)
def _no_test_starts_a_real_step(monkeypatch):
    """A test that replaced the list of steps and then called main() ran the real gate from
    inside the tests, in a project that builds its steps in a function of its own. A project's
    steps here start browsers. So nothing below may start a step the gate really runs. A test
    gives main() its steps with _give(); a test that forgets fails here, before any process
    starts."""
    real_run_step = check.run_step

    def run_step(step):
        if step.command in _REAL_COMMANDS:
            raise AssertionError(
                f"a test was about to start a real step of the gate: {' '.join(step.command)}. "
                "Give main() its steps with _give(), never the gate's own")
        return real_run_step(step)

    monkeypatch.setattr(check, "run_step", run_step)


def _give(monkeypatch, steps: list) -> None:
    """What main() gets when it asks for its steps: these, and nothing of the gate's own.

    The one function is replaced, never the list it reads: a project may build its steps
    anywhere, and main() asks in one place.
    """
    monkeypatch.setattr(check, "steps_for", lambda form: steps, raising=False)


def _nothing_starts(monkeypatch) -> list:
    """Replace the two ways the gate starts a process. What was asked for is noted, and refused."""
    asked: list = []

    def refused(args, *rest, **kwargs):
        asked.append(args)
        raise OSError("this test lets no process start")

    monkeypatch.setattr(check.subprocess, "Popen", refused)
    monkeypatch.setattr(check.subprocess, "run", refused)
    return asked


def test_a_test_cannot_start_a_real_step_of_the_gate(monkeypatch):
    assert _REAL_COMMANDS, "the gate has no step at all"
    asked = _nothing_starts(monkeypatch)
    for command in _REAL_COMMANDS:
        with pytest.raises(AssertionError, match="real step"):
            check.run_step(check.Step(name="one of the gate's own", command=list(command), timeout=30))
    assert asked == [], f"a real step got as far as starting a process: {asked}"


def test_main_given_no_steps_by_a_test_starts_nothing_real(monkeypatch):
    """A test that calls main() and forgets _give() gets the gate's own steps. It must fail,
    and no process may start: the first real step runs this file."""
    asked = _nothing_starts(monkeypatch)
    monkeypatch.delenv(check.RUNNING, raising=False)
    with pytest.raises(AssertionError, match="real step"):
        check.main([])
    assert asked == [], f"main() got as far as starting a process: {asked}"


def test_main_takes_its_steps_from_one_function_and_reads_no_list_itself(monkeypatch, tmp_path, capsys):
    """main() asks steps_for() once, and runs or lists what it gets. A main() that also read
    a list of its own would run steps no test had replaced."""
    assert callable(getattr(check, "steps_for", None)), (
        "scripts/check.py has no steps_for(): main() reads its list itself, and a test must know where")
    asked: list[str] = []
    ran, stray = tmp_path / "ran.txt", tmp_path / "stray.txt"

    def steps_for(form):
        asked.append(form)
        return [check.Step(name="given by the test", command=_touch(ran), timeout=30)]

    monkeypatch.setattr(check, "steps_for", steps_for)
    monkeypatch.setattr(check, "STEPS", [check.Step(name="read from the list", command=_touch(stray), timeout=30)],
                        raising=False)
    monkeypatch.delenv(check.RUNNING, raising=False)

    for argv, runs in (([], True), (["--list"], False)):
        asked.clear()
        ran.unlink(missing_ok=True)
        assert check.main(argv) == 0, argv
        out = capsys.readouterr().out
        assert asked == ["whole"], f"{argv}: main() asked for {asked}, not once for the whole gate"
        assert ran.exists() == runs, f"{argv}: the step main() was given {'did not run' if runs else 'ran'}"
        assert "given by the test" in out and "read from the list" not in out, f"{argv}: {out}"
    assert not stray.exists(), "main() ran a step it read from the list, not the one it was given"


def test_the_one_function_says_which_forms_it_knows():
    """A form nobody wrote must stop, not come back as the whole gate."""
    steps_for = getattr(check, "steps_for", None)
    assert callable(steps_for), "scripts/check.py has no steps_for()"
    with pytest.raises(ValueError):
        steps_for("quik")
    assert _REAL_STEPS and all(isinstance(step, check.Step) for step in _REAL_STEPS), "the gate gives no step"


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
    assert _REAL_STEPS, "the gate ships with no steps"
    first = _REAL_STEPS[0].command
    assert first[0] == sys.executable, "run pytest with the interpreter running the gate, not whatever is on PATH"
    assert first[1:3] == ["-m", "pytest"]
    assert "tests" in first
    report = [arg for arg in first if arg.startswith("-r")]
    assert len(report) == 1 and all(letter in report[0] for letter in "fEs"), (
        f"pytest must end by naming every failed, errored and skipped test (-rfEs); it is given {report}"
    )


def test_no_step_is_a_shell_string_or_hides_output():
    for step in _REAL_STEPS:
        assert isinstance(step.command, list), f"{step.name}: a command is a list of arguments, never one shell string"
        joined = " ".join(step.command)
        assert "|" not in joined and "tail" not in step.command, (
            f"{step.name}: output must not be piped or cut; the line that explains a failure is often not the last"
        )
        assert step.timeout > 0, f"{step.name}: every step needs a time limit"
        cleanup = getattr(step, "cleanup", None)
        assert cleanup is None or (isinstance(cleanup, list) and cleanup), (
            f"{step.name}: a cleanup is a list of arguments too, or None")


def _marker_step(monkeypatch, tmp_path) -> Path:
    """Give main() one harmless step that leaves a file behind, in place of the real steps.

    The tests below call `main()`. With the real steps in place, a bug in `main()` would
    run the whole suite from inside the suite, and that run would do the same, without end.
    """
    marker = tmp_path / "the-step-ran.txt"
    _give(monkeypatch, [_step("leaves a marker", f"open({str(marker)!r}, 'w').close()")])
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


# ---------------------------------------------------------------- a step near its limit


def _each_took(monkeypatch, seconds: dict[str, float], fails: str = "") -> None:
    """Every step ends at once, and is said to have taken the seconds given for its name."""
    def run_step(step):
        ok = step.name != fails
        return check.StepResult(ok, "" if ok else "exit code 1", "", seconds=seconds[step.name])

    monkeypatch.setattr(check, "run_step", run_step)


def _named(name: str, limit: int) -> "check.Step":
    return check.Step(name=name, command=[PY, "-c", "pass"], timeout=limit)


def test_a_step_that_used_most_of_its_limit_is_said_to(monkeypatch, capsys):
    """The seconds showed a step at 83 % of its limit, on a day the machine was busy. Nothing
    said that the next busy day would stop it. More than 80 % of the limit is said on the
    step's own line, and again at the end, where a person looks."""
    _each_took(monkeypatch, {"unit tests": 12.34, "the long suite": 3076.04})
    assert check.run([_named("unit tests", 600), _named("the long suite", 3700)]) == 0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert "-- unit tests: 12.3 s" in lines, lines
    assert "-- the long suite: 3076.0 s, 83 % of its limit of 3700 s" in lines, lines
    assert lines[-2:] == ["All local checks passed.", "Near its limit: the long suite (83 % of 3700 s)."], lines[-2:]


def test_the_line_is_drawn_above_80_percent_and_not_at_it(monkeypatch, capsys):
    _each_took(monkeypatch, {"at the line": 80.0, "just over": 80.5, "at the limit": 99.96})
    assert check.run([_named("at the line", 100), _named("just over", 100), _named("at the limit", 100)]) == 0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert "-- at the line: 80.0 s" in lines, lines
    assert "-- just over: 80.5 s, 80 % of its limit of 100 s" in lines, lines
    assert "-- at the limit: 100.0 s, 99 % of its limit of 100 s" in lines, lines
    assert lines[-1] == "Near its limit: just over (80 % of 100 s), at the limit (99 % of 100 s).", lines[-1]


def test_a_run_with_no_step_near_its_limit_ends_as_it_always_did(monkeypatch, capsys):
    _each_took(monkeypatch, {"unit tests": 12.34})
    assert check.run([_named("unit tests", 600)]) == 0
    out = capsys.readouterr().out
    assert out.strip().splitlines()[-1] == "All local checks passed." and "limit" not in out, out


def test_a_failing_run_still_ends_on_the_failure_whatever_was_near_its_limit(monkeypatch, capsys):
    _each_took(monkeypatch, {"slow and sound": 95.0, "breaks": 96.0}, fails="breaks")
    assert check.run([_named("slow and sound", 100), _named("breaks", 100)]) == 1
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert lines[-2:] == ["-- breaks: 96.0 s, 96 % of its limit of 100 s",
                          "FAILED at step 2, breaks: exit code 1"], lines[-2:]


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
    # The next three are copied from runs made on 2026-11-23: Vitest 5.1.0 and pytest 9, each
    # with one test that did not run. Every one of them ended with exit code 0.
    "Vitest, a skipped test":
        " Test Files  1 passed (1)\n      Tests  1 passed | 1 skipped (2)\n   Start at  09:03:59",
    "Vitest, a test that is still to do":
        " Test Files  1 passed (1)\n      Tests  1 passed | 1 todo (2)\n   Start at  09:03:57",
    "pytest, its line for a skipped test with no summary after it": "SKIPPED [1] test_x.py:6: not today",
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
    "Vitest, clean": " Test Files  1 passed (1)\n      Tests  1 passed (1)\n   Start at  09:03:59",
    "a count of none still to do": "Tests  4 passed | 0 todo (4)\nℹ todo 0\n# todo 0",
    "the word todo in ordinary output": "todo: convert the last 3 of them\n5 passed in 0.1s",
    "a number before a label that ends with the word": "left over, 12 todo: see the list\n5 passed in 0.1s",
    "pytest's word with no count in brackets": "SKIPPED tests are listed below\nSKIPPED [0] none\n5 passed in 0.1s",
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


def test_the_reason_names_the_line_that_showed_the_skip():
    """A person reads the reason first. It must point at the line to look for."""
    for output, shown in (("      Tests  1 passed | 1 todo (2)", "1 todo"),
                          ("SKIPPED [1] test_x.py:6: not today", "SKIPPED [1]")):
        result = check.run_step(_step("a test that did not run", _printed(output)))
        assert result.reason == f"a test was skipped ({shown}); the output above names it", result.reason


def test_the_gate_says_which_tools_it_reads():
    """Projects asked whether Vitest's and Playwright's `N skipped` is read. It is, as pytest's
    shape, and the comment above the shapes is where a person looks for the answer."""
    source = (ROOT / "scripts" / "check.py").read_text(encoding="utf-8")
    block = source[source.index("# A SKIPPED TEST FAILS THE GATE"):source.index("def _skipped(")]
    # The comment's own lines only: the name of a pattern below it holds a tool's name too.
    comment = "\n".join(line for line in block.splitlines() if line.startswith("#"))
    for tool in ("pytest", "node --test", ".NET", "unittest", "Vitest", "Playwright"):
        assert tool in comment, f"the comment above the skip shapes does not name {tool}"


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


# ---------------------------------------------------------------- what the tree stop cannot reach


def _notes(log: Path, word: str, then: str = "") -> list[str]:
    """A command that adds one word to a file, so the file's words are the order things ran in."""
    return [PY, "-c", f"open({str(log)!r}, 'a').write({word + ' '!r}); {then}"]


def _words(log: Path) -> list[str]:
    return log.read_text().split() if log.exists() else []


def test_a_steps_cleanup_runs_before_the_step_starts(tmp_path):
    """A container is not a child process: `docker run` asks a service for it, so the tree stop
    never reaches one. A project that runs its suite in a container wrote this itself: a
    command that removes it by name, run before the step, for what an earlier run left."""
    log = tmp_path / "order.txt"
    step = check.Step(name="in a container", command=_notes(log, "step"), cleanup=_notes(log, "cleanup"), timeout=30)
    result = check.run_step(step)
    assert result.ok, result.reason
    assert _words(log) == ["cleanup", "step"], (
        f"a step with a cleanup ran {_words(log)}: the cleanup runs once before it, and not after a step that ended")


def test_a_step_that_fails_by_itself_is_not_cleaned_up_after(tmp_path):
    log = tmp_path / "order.txt"
    step = check.Step(name="breaks", command=_notes(log, "step", then="raise SystemExit(1)"),
                      cleanup=_notes(log, "cleanup"), timeout=30)
    result = check.run_step(step)
    assert not result.ok and "exit code 1" in result.reason
    assert _words(log) == ["cleanup", "step"]


def test_a_step_with_no_cleanup_runs_as_it_always_did(tmp_path):
    log = tmp_path / "order.txt"
    assert check.Step(name="plain", command=[PY, "-c", "pass"]).cleanup is None
    assert check.run_step(check.Step(name="plain", command=_notes(log, "step"), timeout=30)).ok
    assert _words(log) == ["step"]


def test_a_step_past_its_limit_is_cleaned_up_again(tmp_path):
    log = tmp_path / "order.txt"
    step = check.Step(name="hangs in a container", command=_notes(log, "step", then="import time; time.sleep(60)"),
                      cleanup=_notes(log, "cleanup"), timeout=2)
    started = time.monotonic()
    result = check.run_step(step)
    assert not result.ok and "timed out" in result.reason.lower()
    assert time.monotonic() - started < 20
    assert _words(log) == ["cleanup", "step", "cleanup"], (
        f"a step stopped at its limit ran {_words(log)}: what it started outside its own processes is still there")


def test_a_gate_stopped_by_hand_cleans_up_before_it_passes_the_stop_on(tmp_path, monkeypatch):
    log = tmp_path / "order.txt"
    command = _notes(log, "step", then="import time; time.sleep(20)")
    interrupted = []

    class Interrupted(subprocess.Popen):
        """A Popen whose first wait, on the step alone, is cut short as by Ctrl+C."""

        def wait(self, timeout=None):
            if self.args == command and not interrupted:
                interrupted.append(True)
                end = time.monotonic() + 20
                while "step" not in _words(log) and time.monotonic() < end:
                    time.sleep(0.05)
                raise KeyboardInterrupt
            return super().wait(timeout)

    monkeypatch.setattr(check.subprocess, "Popen", Interrupted)
    try:
        with pytest.raises(KeyboardInterrupt):
            check.run_step(check.Step(name="interrupted", command=command, cleanup=_notes(log, "cleanup"), timeout=30))
    finally:
        monkeypatch.undo()
    assert interrupted, "the gate never waited on the step"
    assert _words(log) == ["cleanup", "step", "cleanup"], (
        f"a gate stopped by hand ran {_words(log)}: the cleanup must run before the stop is passed on")


def test_a_cleanup_that_fails_is_said_and_never_fails_the_step(capsys):
    """Removing what is not there may end with an error, and that is the usual case. The step's
    own result is the only one that counts; a cleanup that did not end well is one line, then
    everything it printed. A cleanup that ended well prints nothing."""
    fails = [PY, "-c", "import sys; print('no such container: suite'); sys.exit(3)"]
    result = check.run_step(check.Step(name="suite", command=[PY, "-c", "print('the step ran')"], cleanup=fails, timeout=30))
    assert result.ok, f"a cleanup that failed has failed its step: {result.reason}"
    lines = capsys.readouterr().out.splitlines()
    assert "-- suite: its cleanup ended with exit code 3" in lines, lines
    assert "no such container: suite" in lines, "what the failed cleanup printed was not shown"
    assert lines.index("-- suite: its cleanup ended with exit code 3") < lines.index("the step ran")
    assert "no such container" not in result.output, "the cleanup's output was kept as the step's own"

    quiet = [PY, "-c", "print('removed: suite')"]
    assert check.run_step(check.Step(name="suite", command=[PY, "-c", "pass"], cleanup=quiet, timeout=30)).ok
    assert "removed" not in capsys.readouterr().out, "a cleanup that ended well printed its output"


def test_a_cleanup_that_cannot_start_is_said_and_the_step_still_runs(tmp_path, capsys):
    log = tmp_path / "order.txt"
    step = check.Step(name="suite", command=_notes(log, "step"), cleanup=["no-such-program-on-this-machine"], timeout=30)
    assert check.run_step(step).ok
    assert _words(log) == ["step"]
    said = [line for line in capsys.readouterr().out.splitlines() if line.startswith("-- suite: its cleanup could not start")]
    assert len(said) == 1, "nothing says that the cleanup could not start"


def test_a_cleanup_that_hangs_is_stopped_at_its_own_limit(tmp_path, monkeypatch, capsys):
    """Every step has a time limit so that a hung process cannot hang the gate. A cleanup that
    waits on a service which is down would hang it just the same."""
    assert isinstance(getattr(check, "CLEANUP_LIMIT", None), int) and check.CLEANUP_LIMIT > 0, (
        "scripts/check.py has no CLEANUP_LIMIT, the seconds a cleanup may take")
    monkeypatch.setattr(check, "CLEANUP_LIMIT", 2)
    log, beat = tmp_path / "order.txt", tmp_path / "beat.txt"
    hangs = [PY, "-c", _CHILD, str(beat)]       # it writes ten times a second, for 40 seconds
    started = time.monotonic()
    try:
        result = check.run_step(check.Step(name="suite", command=_notes(log, "step"), cleanup=hangs, timeout=30))
        assert time.monotonic() - started < 20, "the gate waited on a cleanup that hung"
        assert result.ok and _words(log) == ["step"], "a cleanup that hung kept its step from running"
        assert "-- suite: its cleanup passed its limit of 2 s, and was stopped" in capsys.readouterr().out.splitlines()
        assert _wait_for(beat, seconds=1), "the cleanup never started: the test proved nothing"
        assert not _still_beating(beat), "the cleanup was said to be stopped, and it is still running"
    finally:
        _stop_leftovers(beat)


def test_a_cleanup_is_told_the_gate_is_running(tmp_path):
    seen = tmp_path / "seen.txt"
    code = f"import os; open({str(seen)!r}, 'w').write(os.getcwd() + '|' + os.environ.get({check.RUNNING!r}, ''))"
    step = check.Step(name="suite", command=[PY, "-c", "pass"], cleanup=[PY, "-c", code], timeout=30)
    assert check.run_step(step).ok
    folder, _, running = seen.read_text().partition("|")
    assert os.path.samefile(folder, ROOT), f"the cleanup ran in {folder}, not at the repository's root"
    assert running == "1", "a cleanup is not told that the gate is running, so it could start the gate"


def test_the_list_names_a_steps_cleanup(monkeypatch, tmp_path, capsys):
    _give(monkeypatch, [
        check.Step(name="unit tests", command=_touch(tmp_path / "a.txt"), timeout=30),
        check.Step(name="suite", command=_touch(tmp_path / "b.txt"), timeout=30,
                   cleanup=["docker", "rm", "-f", "suite-tests"]),
    ])
    assert check.main(["--list"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 2 and not list(tmp_path.iterdir()), "--list ran a step or a cleanup"
    assert "cleanup" not in lines[0], lines[0]
    assert lines[1].endswith("[cleanup: docker rm -f suite-tests]"), lines[1]

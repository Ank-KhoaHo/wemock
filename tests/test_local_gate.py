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

import re
import sys
import time
from pathlib import Path

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

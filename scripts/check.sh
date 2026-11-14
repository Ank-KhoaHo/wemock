#!/usr/bin/env bash
# The full local gate for wemock. CI runs the same steps (.github/workflows/ci.yml).
# Fails on any skipped test: a skip is an assertion that did not run.
#
# The Node steps run through scripts/extension_step.py: each has a time limit, a skipped
# test fails it, and when it ends it stops every process it started, by process ID. A test
# browser left running after a hung test has locked this machine's Windows account before.
set -eo pipefail
cd "$(dirname "$0")/.."

mkdir -p .check
step() { echo; echo "=== $1"; }

step "typecheck"
python scripts/extension_step.py typecheck

step "build"
python scripts/extension_step.py build > .check/build.out

step "extension checks (site access, version, sources archive)"
python scripts/extension_step.py checks

step "unit (vitest)"
python scripts/extension_step.py unit 2>&1 | tee .check/vitest.out

step "end to end (playwright)"
python scripts/extension_step.py browser 2>&1 | tee .check/e2e.out

step "python tests (docs guard, gate scripts)"
python -m pytest -q -rs tests/ 2>&1 | tee .check/pytest.out
if grep -qE '[0-9]+ skipped' .check/pytest.out; then
  echo "FAIL: pytest skipped tests"; exit 1
fi

echo; echo "ALL CHECKS PASSED (local; CI is separate)"

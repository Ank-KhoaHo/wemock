<!--
Thank you for contributing. The checklist below is short on purpose: anything a test or CI
check can catch for itself is left to it. What is listed here is what nothing else catches.

Delete anything that does not apply.
-->

## What this changes, and why

<!-- The behaviour, not the diff. If it fixes something, what was the symptom? -->

## Correctness

- [ ] The change is covered by a test that fails without it, wherever the project has a way to
      write one.
- [ ] Existing tests and checks still pass.

## Claims

- [ ] If this changes what the project does or does not do, `README.md` or `ROADMAP.md` says
      so — not only this description, which nobody reads again after the merge.
- [ ] A documented limitation that this change removes is removed from where it was
      documented, not just fixed in code.

## Housekeeping

- [ ] Commit messages explain **why**, not just what.
- [ ] No `Co-Authored-By` trailer.
- [ ] Nothing in this change publishes working material. `python scripts/check_leaks.py` is
      clean, and the commit messages do not summarise what was withheld

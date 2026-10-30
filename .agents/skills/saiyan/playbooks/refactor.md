# Refactor

Behavior stays the same. The proof is that the checks that passed before still pass.

1. **Record the baseline.** Run the tests and the `verify-*` skill first and save the results.
2. **Remove first.** Delete dead code, unused exports, and redundant checks before restructuring (`principals/subtract-before-you-add.md`).
3. **Move in small steps.** Each step compiles and passes the baseline checks. Migrate callers and delete the old API in the same step, with no compatibility layer.
4. **Re-run the baseline** and compare. Any difference is a bug in the refactor or a bug that was hidden before. Say which.
5. Run `playbooks/ship.md`.

**Reply:** what moved, what was deleted, and the before and after check results.

# Bug fix

Every shipped line traces to evidence. A guard that "might help" is a guess, not a fix, so it does not ship.

1. **Reproduce it yourself** on the surface where it happens (the app, the CLI, the API). Use the project's `verify-*` skill to drive it. Ask the human only with a specific reason you cannot reach it.
2. **Find the cause.** List candidate causes, then rule them out with runtime evidence until one survives. Add logging if the state is unclear. Read `principals/fix-root-causes.md`.
3. **Write the failing check first** when a cheap test exists (see `principals/test-behavior-not-implementation.md`). Commit it before the fix so history shows fail, then pass.
4. **Make the smallest change the evidence justifies.** Revert anything the evidence did not support.
5. **Verify on the same surface.** The original repro must now pass. "Inconclusive" is not a pass.
6. Run `playbooks/ship.md`.

**Reply:** what was broken, the root cause, the fix, and the failing-then-passing output.

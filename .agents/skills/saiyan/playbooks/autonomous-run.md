# Autonomous run

Define done, then drive to it without stopping to ask.

1. **State the exit condition** as something checkable before the first iteration (tests green, repro fixed, all N tickets merged).
2. **Set a budget**: a maximum number of iterations, and a point at which you stop and report. Write both in the progress log.
3. **Each iteration:** make the smallest change the evidence justifies, check it against the exit condition, keep it if it moved things forward, revert it if not.
4. **Log every iteration** with the `task-progress` skill: what changed and whether the exit condition moved.
5. **Fix side problems yourself** (a flaky test, a broken script), preferably in their own commit or PR. Return to the exit condition after each.
6. **Stop** when the exit condition holds. A plateau means change approach, never weaken the condition. Stop early and report for an irreversible action, a product call no experiment can settle, a failed check you cannot fix within three tries, or the budget running out.

**Reply:** the exit condition, iterations run, what landed, what was discarded, and the final state.

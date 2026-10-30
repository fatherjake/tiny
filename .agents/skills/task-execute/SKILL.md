---
name: task-execute
description: Carry out an existing task plan unit by unit, checking each unit and logging progress, until the exit condition holds. Use after task-create, or when the user says "execute the task", "keep going", or "build the plan".
---

# Execute a task

Run the plan in `.agents/tasks/<slug>/plan.md` to its exit condition.

## Before you start

1. Read the plan, the progress log, and the `saiyan` playbook that fits (`bug-fix`, `feature`, `refactor`).
2. Set `status: in-progress` in the plan. Work on a branch, not `main`, unless the user said otherwise.
3. If the plan has no exit condition or any unit lacks a check, stop and fix the plan first.

## The loop

For each unit, in order:

1. **Do the smallest change** that satisfies the unit. Follow the repo's conventions. Prefer deleting and reusing (`saiyan/principals/laziness-protocol.md`).
2. **Run the unit's check.** Fix and re-run up to three times. After three failures, stop and report what you tried. Do not weaken the check.
3. **Commit** explicit paths with a message in the repo's style.
4. **Log it** with `task-progress`: a row for what was done and whether the check passed. Update the plan's unit status.
5. **Move on.** Do not hand back at a unit boundary. "Keep going until it's done" covers the whole plan.

## Stop and ask only for

- A check that fails after three attempts.
- An irreversible action (production data, deploys, money, force-push, deleting someone else's work).
- A real ambiguity where two readings give materially different work.
- The plan running out of units.

## Finish

1. Run the exit condition itself, not a proxy (`saiyan/principals/prove-it-works.md`). Paste the output.
2. Run `saiyan/playbooks/ship.md` for the pull request.
3. Set `status: complete` and a final `task-progress` row. Note what is left that you could not verify.
4. Run `task-review`, commit its report on the same branch, and push it to the open PR.
5. Reply with the exit condition result, the PR, and what is open.

## When something breaks the plan

If you learn the plan is wrong, edit the plan, log why in `task-progress`, and continue. Do not quietly drift from it. If the same mistake shows up twice, fix it in structure, such as a script or a lint rule, not another reminder (`saiyan/principals/encode-lessons-in-structure.md`).

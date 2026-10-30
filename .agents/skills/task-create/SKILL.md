---
name: task-create
description: Turn a goal into a written task plan with checkable steps, before any code is written. Use when the user says "let's do this task", "plan this", or the work spans several files, PRs, or sittings. Not for quick edits or questions.
---

# Create a task

The plan is the deliverable. Do not implement anything here.

## Steps

1. **Pick a slug** (`late-fee-on-roll`) and create `.agents/tasks/<slug>/`.
2. **Skip the plan** if the change is one or two files with an obvious approach. Say so and stop.
3. **Read before writing.** Read the code and docs the task touches, and the project's `verify-*` feature files for any user-facing path.
4. **Settle open questions by trying.** A small prototype or a command run beats asking. Ask the human only about product calls no experiment can settle, and give options.
5. **Write `plan.md`** from `references/plan-template.md`. Fill every section. One unit of work per PR or commit group, each ending in something you can check.
6. **Check the plan against the repo.** Open the files it names. Confirm they exist and that the interface it assumes is real. Fix the plan, not your memory of the code.
7. **Create the progress log** with the `task-progress` skill (a header row and a first `plan` row).
8. **Hand back.** State the plan path and the exit condition, then stop. Start only on the human's go. If they have said "do it all" or "keep going until done", hand straight to `task-execute`.

## Rules

- Every unit names its check: a command, a test, a screenshot, a file, or a value to read.
- State the exit condition for the whole task in one line near the top.
- Phrase units as outcomes ("API returns `late_fee_cents`"), not activities ("work on API").
- If the task needs tickets in a tracker, list them in the plan in landing order. This skill does not assume which tracker.

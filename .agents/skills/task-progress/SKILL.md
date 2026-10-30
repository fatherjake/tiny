---
name: task-progress
description: Keep a running record of a task: key decisions, progress so far, and what is left. Use during any task-execute run, long or unattended work, or when the user asks "where are we", "what's left", or "why did you do that".
---

# Task progress

One log per task at `.agents/tasks/<slug>/progress.tsv`, one row per decision or checkpoint. Append only. A wrong call gets a new row that supersedes it.

Adapted from pstack's `show-me-your-work` (MIT, see `NOTICE.md`).

## Columns

`ts	kind	unit	what	why	evidence	result`

- **ts**: ISO 8601 timestamp.
- **kind**: `plan`, `decision`, `progress`, `blocker`, `revert`, or `done`.
- **unit**: the plan unit number or name.
- **what**: what was chosen or done, one line, in plain words.
- **why**: the reason in plain words.
- **evidence**: a pointer, never a paragraph: commit SHA, PR number, `file:line`, or artifact path.
- **result**: the outcome: `check passed`, `reverted`, `open`, `blocked`.

## Logging

Use `scripts/log.sh <logfile> <kind> <unit> <what> <why> <evidence> <result>`. It stamps the time, writes the header on first use, strips tabs and newlines, and neutralizes cells that start with `=`, `+`, `-`, or `@`.

Log forks chosen, units completed with their check result, pivots and reverts with their trigger, and blockers. Skip trivial steps.

## Answering "where are we"

Read the log and the plan, then reply with three short parts:

1. **Done**: units completed, with their evidence.
2. **Key decisions**: the choices that shaped the work, and why.
3. **Left**: remaining units, open blockers, and anything unverified.

## Where it lives

The plan is committed. `progress.tsv` stays local by default (the repo's `.gitignore` excludes it). Commit it only when a reviewer needs the trail to trust a large change.

## Check the log is honest

At the end of a run, walk the rows against what happened. Every row should map to a real action, and every evidence pointer should resolve.

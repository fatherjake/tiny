---
task: api-indexes
status: unreviewed
finished: 2026-11-02
tool: cursor
outcome: exit condition met
---

# Review: api-indexes

## Result in one line

The UI reads trades, orders, fills, candles and funding from query tables that rebuild from the block log. `uv run pytest` reported 101 passed, and a live sim returned those routes.

## Skills

| Skill | Verdict | Evidence |
| --- | --- | --- |
| saiyan | used | Observed. Description matches a feature. The feature playbook's steps were the todo list. |
| task-create | used | Observed. `.agents/tasks/api-indexes/plan.md` was written before the store. |
| task-execute | used | Observed. Units were committed in order on `api-indexes`. Not pushed, because the user said not to. |
| task-progress | used | Observed. `progress.tsv` has the unit rows. |
| python | used | Observed. Read before editing `core/`. Line limit held: `core/state.py` 724, `core/store.py` 516. |
| commit | used | Observed. Explicit paths, no push. The skill says to push; the user and `AGENTS.md` said not to. |
| verify-create | used | Observed, late. `verify-tiny` was written after the code and then run: curl of `/trades/BTC-PERP` saved under `.qa/verify-tiny/`. |
| task-review | used | Observed. This file. |
| review-sweep | not relevant | Nightly, not this session. |
| bruh | not relevant | Not part of this work. |

Principals read and used: type-system-discipline (book match stayed `Match`, the log record is `Fill`, and order events carry side, type, price and size), laziness-protocol (candles are a query), test-behavior-not-implementation (literal rows), prove-it-works (pytest and a live curl).

## Friction

- **Human corrections:** none in this session. Observed.
- **Failed checks and retries:** `ruff format --check` failed once on `core/__main__.py` for a long line. Fixed by formatting that file. `.agents/skills/python/references/patterns.md` already fails `ruff format --check` on this branch and on the parent; left it. Observed.
- **Rework:** The tree had no `core/store.py`. The block log was added with the indexes. Observed. Docstrings in `core/` were stripped by something outside the edits and restored. Observed. `579cd94` and merge `fa6b13d` on `origin/main` appeared without an explicit push from this session. Guess: another process committed and pushed the early store commit.
- **Time or cost sink:** Finding that the persistence layer was not on the branch, and separating that main merge from the rest of the work. Observed.

## What went well

Literal event and row assertions failed fast when the order of fills and order updates was wrong. Replaying the same blocks through `MemoryStore` and `SqliteStore` made the rebuild check one comparison.

## Proposed fixes

| Fix | File to change | Why | Seen before? |
| --- | --- | --- | --- |
| Say "push only when the user or AGENTS.md asks" in the commit steps | `.agents/skills/commit/SKILL.md` | The skill says to push. This task said not to. Observed conflict. | unknown |
| Note in the feature playbook that a missing store named by the task is in scope when the indexes cannot exist without it | `.agents/skills/saiyan/playbooks/feature.md` | The request assumed `core/store.py`. It was not in the repo. Guess this will recur on stacked tasks. | no |

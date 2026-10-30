---
task: hotstuff
status: unreviewed
finished: 2026-10-30
tool: cursor
outcome: exit condition met
---

# Review: hotstuff

## Result in one line

Shipped chained HotStuff and the in-memory cluster on `state-machine` (not pushed). The five fault tests pass without xfail. The price feed was not started.

## Skills

| Skill | Verdict | Evidence |
| --- | --- | --- |
| saiyan | used | Observed. Autonomous-run playbook: exit was the fault tests, budget was six iterations. Description: "long unattended run". |
| python | used | Observed. Read `SKILL.md` before editing `.py`. Description: "Use when reading or editing any .py file." |
| task-progress | used | Observed. Rows in `.agents/tasks/hotstuff/progress.tsv` (gitignored). Description: "long or unattended work". |
| task-review | used | Observed. This file. Description: "After finishing a task, write a short review". |
| commit | used | Observed. Explicit paths, no push. `AGENTS.md` forbids the skill's push step. Description: "then push". |
| task-create | should have fired | Observed that it was not read. Description: "the work spans several files". The exit was already one sentence, so a plan would have been short. |
| task-execute | should have fired | Observed that it was not read. Description: "when the user says ... keep going". The user said keep going. There was no plan file to execute. |
| verify-create | should have fired | Observed that it was read and not run. `sim/__main__.py` still raises, and the stop line was the price feed. Pytest was the check that ran (`55 passed`). |
| verify-example | not relevant | Description: "Not for real use." |
| review-sweep | not relevant | Description: nightly pass, not this task. |
| bruh | not relevant | Description: restate the last message. Nobody asked. |

## Friction

- **Human corrections:** none. Observed. The user was away.
- **Failed checks and retries:** two, then the suite passed. Observed. `test_two_crashed_nodes_halt_but_stay_safe` gained one commit because a proposal was treated as certified; commit now waits for a quorum certificate. The lossy test did not finish within 120s while every view rebroadcast the whole chain; rebroadcast moved to timeouts only, and the same test then passed.
- **Rework:** those two consensus changes. Observed. No file was reverted.
- **Time or cost sink:** the full-chain rebroadcast. Observed. A 2s lossy run took 5s of wall time before it was removed; the 10s run then took 8.6s.

## What went well

The fault tests were left intact and named the two bugs. Delay 0 on the cluster clock made a `run_for` boundary a quiet point, which is what the halt check needs.

## Proposed fixes

| Fix | File to change | Why | Seen before? |
| --- | --- | --- | --- |
| Say not to push when the user or `AGENTS.md` forbids it | `.agents/skills/commit/SKILL.md` | The skill says push; this task must not. Observed. | yes, `.agents/tasks/state-machine/review.md` |
| Don't add a full-history retransmit until a check has failed for lack of it | `.agents/skills/saiyan/playbooks/autonomous-run.md` | The rebroadcast was added before the lossy test failed, and it was the cost sink. Observed. | no |
| When `python -m sim` still raises, say pytest is the check instead of blocking done on `verify-create` | `AGENTS.md` | `verify-create` matched, and running it would have started the price feed this task was told to stop before. Observed. | yes, the state-machine review noted the skip and did not name a file |

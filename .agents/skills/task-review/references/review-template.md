---
task: <slug>
status: unreviewed
finished: <ISO date>
tool: <cursor | cloud agent | codex | other>
outcome: <exit condition met | partly | not met>
---

# Review: <slug>

## Result in one line

<What shipped or what did not, in plain words.>

## Skills

| Skill | Verdict | Evidence |
| --- | --- | --- |
| `<skill name>` | used / should have fired / not relevant | <observed or guess, and the description line or the step it helped> |

## Friction

One line each. Mark observed or guess.

- **Human corrections:** <what the human had to redirect, and what triggered it>
- **Failed checks and retries:** <what failed, how many attempts, the cause>
- **Rework:** <files rewritten or reverted, and why>
- **Time or cost sink:** <where it went, if you can tell>

## What went well

<Things worth keeping: a skill or playbook step that saved real effort. One to three lines.>

## Proposed fixes

| Fix | File to change | Why | Seen before? |
| --- | --- | --- | --- |
| <specific change> | `<path>` | <the evidence above that justifies it> | <yes, where / no / unknown> |

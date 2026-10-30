---
name: review-sweep
description: Nightly pass over finished tasks. Reads unreviewed task reviews, fixes the skills and playbooks they point at, records patterns, then deletes completed tasks and processed reports. Use on a schedule, or when the user says "run the review sweep" or "act on the task reviews".
---

# Review sweep

Turn `.agents/tasks/*/review.md` reports into fixes, then tidy up. Run it unattended on its own branch and finish with a pull request.

## Steps

1. **Branch.** `git switch -c review-sweep/<date>` from the default branch. Never commit to the default branch.
2. **Collect.** Find every task folder whose `review.md` has `status: unreviewed`. If there are none, stop and say so. Do not open an empty PR.
3. **Read the evidence.** For each report, read it with the plan and the commits it cites. Check the claims you will act on: does the cited skill description really match, did the cited commit really show the rework? Drop a claim you cannot confirm.
4. **Update the tally.** `.agents/review-patterns.md` holds one row per observation not yet fixed: the observation, the fix proposed, a count, and the tasks it came from. Add new observations and bump counts on repeats.
5. **Decide what to fix now.**
   - Fix now when an observation has a count of two or more, or when it is a one-off with a clear, small and low-risk fix (a vague description, a missing step in a playbook).
   - Otherwise leave it in the tally. Do not change a skill because of one odd run.
   - Prefer structure over prose: a script, a check, or a lint rule beats another paragraph (`saiyan/principals/encode-lessons-in-structure.md`). Prefer deleting or tightening a skill over adding to it.
   - A skill that never fires across several reports gets its description rewritten, merged into another, or deleted.
6. **Make the fixes** as small commits with explicit paths. Name the reports each fix came from in the commit message.
7. **Mark processed.** Set `status: reviewed` in each report you handled, with a one-line `outcome:` listing what you changed or why you changed nothing.
8. **Tidy.** Delete a task folder when its plan says `status: complete`, its PR is merged or closed, and its review is `reviewed`. Git history keeps the record. Leave anything in progress, unmerged or unreviewed untouched. Never delete a folder you cannot account for.
9. **Open one PR** for the whole sweep: the reports read, each fix and its evidence, patterns still waiting, and the folders removed. Do not merge it.

## Rules

- Change only skills, playbooks, principals, scripts, `AGENTS.md`, the tally, and the task folders above. Never touch product code.
- Keep `AGENTS.md` short. If a fix would grow it, put the rule in a skill or a script instead.
- Cap the sweep at ten fixes. Leave the rest in the tally for tomorrow.
- If a report mentions a secret or personal data, redact it in the tally and tell the human in the PR.
- Reply with the PR link, the count of reports read, fixes made, and patterns waiting.

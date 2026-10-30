---
name: task-review
description: After finishing a task, write a short review of how the agent did it: which skills it used, which should have fired but did not, where the human had to correct it, and what to change. Use at the end of every task-execute run, and when the user says "review how that went" or "retro".
---

# Review a finished task

Write one report at `.agents/tasks/<slug>/review.md` so a later pass can fix the skills, not just the code. The report is committed with the task. The nightly `review-sweep` reads it.

This is the agent's own account, so it is only as good as what it can see. Say what you observed, and mark the rest as a guess.

## Steps

1. **List what was available.** Read the names and descriptions of every skill in `.agents/skills/` (and any other skill folder the tool loads). Do this from the folder, not from memory.
2. **Reconstruct what happened.** Read the plan, `progress.tsv` if present, the commits, and the conversation. Note the human's corrections, failed checks, retries, reverts and rework files.
3. **Fill in `references/review-template.md`.** Copy it to `.agents/tasks/<slug>/review.md` and complete every section. One line per item, no essays.
4. **Check skills against the work.** For each skill, decide: used, should have been used but was not, or not relevant. A skill "should have fired" when its description matches something you did and you did it without reading the skill. Quote the description line that matches.
5. **Turn each problem into a proposed fix.** A fix names a file and a change: edit this skill's description, add this step to that playbook, add a lint rule or script, create a new skill. "Be more careful" is not a fix.
6. **Set `status: unreviewed`** in the front of the report and commit it with the task.

## Honest limits

- You cannot know about a skill the tool never loaded. If a skill looks absent from your context, say so, because that is itself a finding (its description may be too weak or its folder not discovered).
- Label every claim as `observed` (you can point at it) or `guess`.
- Do not grade yourself kindly. A task that needed three human corrections went badly, whatever the final diff looks like.
- Never put secrets, tokens or personal data in the report.

## Reply

Two lines: how the task went, and the top proposed fix. Do not paste the whole report.

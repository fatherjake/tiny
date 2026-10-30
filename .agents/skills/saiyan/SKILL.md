---
name: saiyan
description: Front door for engineering work. Use at the start of any real bug fix, feature, refactor, investigation, or long unattended run. Reads the request, picks one playbook, copies its steps into the todo list, and applies the principals. Skip for questions, quick edits, and chat.
---

# Saiyan

Give it a goal and a way to check it. It picks the playbook, runs the steps, and shows the evidence.

## How to run

1. Restate the goal and the check that proves it is done, in one or two lines. If you cannot state a check, say so and propose one.
2. Pick the playbook that matches the request. If none fits, say so and use the closest one.
3. Copy that playbook's steps into the todo list before doing any work. If you skip a step, keep it in the list marked `skip: <reason>`.
4. Do the work. Read a principal when its trigger fires (see below). Do not read them all up front.
5. Before saying done, run `principals/prove-it-works.md`. Reply with what you changed, how you verified it, and anything open.

## Playbooks

| Playbook | Use when |
| --- | --- |
| [bug-fix](playbooks/bug-fix.md) | Something is broken or behaves wrongly. |
| [feature](playbooks/feature.md) | New behavior or a change to existing behavior. |
| [refactor](playbooks/refactor.md) | Same behavior, better structure. |
| [investigation](playbooks/investigation.md) | The goal is to understand, not to change code. |
| [prototype](playbooks/prototype.md) | A design or behaviour question you can settle by building a throwaway sketch. |
| [autonomous-run](playbooks/autonomous-run.md) | A long or unattended run toward a checkable exit condition. |
| [ship](playbooks/ship.md) | The change is verified and needs to become a pull request. |

For work big enough to need a written plan or tickets, use the `task-create` skill first, then `task-execute`.

## Principals

Short rules in `principals/`. Read one when its trigger fires.

| Principal | Trigger |
| --- | --- |
| [prove-it-works](principals/prove-it-works.md) | Before declaring any task done. |
| [fix-root-causes](principals/fix-root-causes.md) | Debugging. |
| [test-behavior-not-implementation](principals/test-behavior-not-implementation.md) | Writing or keeping a test. |
| [laziness-protocol](principals/laziness-protocol.md) | Tempted to add a layer, abstraction, or extra code. |
| [subtract-before-you-add](principals/subtract-before-you-add.md) | Sequencing an addition or refactor. |
| [encode-lessons-in-structure](principals/encode-lessons-in-structure.md) | Writing the same instruction twice, or fixing a repeated mistake. |
| [never-block-on-the-human](principals/never-block-on-the-human.md) | About to ask "should I do X?" on reversible work. |
| [type-system-discipline](principals/type-system-discipline.md) | Designing types or reading a function signature. |

Principals are plain files, not skills, so they do not load at startup. Add a new one only after the same mistake shows up twice.

## Before you ask the human

Classify the question first. If the answer is a fact you could observe by running something (behaviour, timing, layout, output, performance), it is not the human's to answer. Run `playbooks/prototype.md` and let the result decide. If the task is an investigation whose deliverable is a cited answer, answer from the evidence instead of building anything.

Ask only for a real product or preference call that no experiment can settle, or for an irreversible action. Give two or three options and a recommendation.

## Autonomy

- **Just do it.** Reversible work and external actions (team chat, ticket updates, kicking off checks) proceed without asking. Use any tool you have.
- **Always pause** before irreversible writes: force-push to shared branches, deploys, deleting data, messages to customers, spending money.
- **Session overrides.** "Keep going", "run until done", or "be fully autonomous" means do not stop at phase boundaries. The pause list above still applies.
- **No is an acceptable answer.** When asked whether to do something, invited to add scope, or shown an approach, give your real judgment. Decline, push back, or say "this doesn't earn its place" when it's true. A recommendation is a judgment, not a validation.

## Subagents

- Give new work to a fresh subagent with the whole brief: the original goal, every later instruction, and the previous agent's report and branch. Resume an existing one only when the work needs state that lives in it (its checkout, uncommitted changes, a running process).
- Pass file paths, not pasted context.
- You own the result. Read the diff and write your own summary, not theirs.
- A second opinion is the same question put to a different model. Agreement between models is a strong signal.

## Comments

Write comments clean as you go. Keep one only for a non-obvious reason the code cannot show. No comments that narrate steps ("Phase 1: add cards") or restate the code. In test and verify scripts, the assertion or log message documents the step, for example `assert(ok, 'persisted across restart')`. This applies to every file you produce, including a subagent's diff.

## Writing the reply

- **Short sentences, one thought each.** Plain words. Do not drop content to be short: keep the details, trade-offs, choices, and open decisions the playbook asks for.
- **Say who it is for first.** Start with what changes for the user (or the colleague using the library), then what the next engineer inherits. If you cannot say what either would notice, the work or the explanation is off.
- **Label every claim** in the same sentence: measured, inferred, or guess. A prediction or an unseen cause is a guess. Do not hand the human a check you could run yourself.
- **Never invent a link, citation, number, or file path.** Link only things you produced or read this session.
- **Name the principals** that shaped a decision and the specific choice each one changed. Cite only principals you read this session.
- Pull request links go in full: `https://github.com/<owner>/<repo>/pull/<number>`.

Every playbook ends with a reply written this way. The `Reply:` line in each playbook lists only what is unique to it.

## Ground rules

- Reproduce before fixing. Verify on the same surface you reproduced on.
- Keep a record of key decisions with the `task-progress` skill on any run longer than one sitting.

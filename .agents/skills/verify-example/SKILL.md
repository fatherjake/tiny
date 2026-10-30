---
name: verify-example
description: Template for a project verification skill. Copy this folder to verify-<app>, fill in every section, and delete this note. Not for real use.
disable-model-invocation: true
---

# Verify <app>

> Template. Replace every `<...>`, then change the frontmatter `name` to `verify-<app>` and write a real description that names the app, the surface, and when to use it.

How to launch, drive, and prove behavior of <app> the way a user does. Read `features/README.md` before driving anything, then use the matching feature file as the recipe. Longer notes are in `reference/`.

## Launch

- Command: `<exact command that starts the app for verification>`
- Ready when: `<log line, port answering, or prompt>`
- Teardown: `<how to stop what you started>`

## Doctor

Run `scripts/doctor.sh` first. It answers one question: is this instance worth driving? It checks the process is up, the build is the one you expect, and the port is ours.

## Drive

- Harness: `<Playwright specs, curl, tmux/PTY, simulator, or CDP>`
- Prefer stable handles (ARIA roles and names, data attributes, routes) over coordinates.
- Start every recipe from the baseline state in `features/README.md`.

## Evidence

- Capture the action and the resulting state, not only the final screen.
- Save artifacts under `<artifacts path>/<feature>/`.
- A success message alone is not proof. Re-read the stored value or reopen the item.

## Cleanup

Run `scripts/cleanup.sh`. Remove instances and scratch data you created. Never remove the evidence.

## Known gotchas

See `reference/gotchas.md`.

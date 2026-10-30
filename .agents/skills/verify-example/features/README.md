# <App> verification map

The maintained source for verifying user-facing behavior. Read this index first, then use the matching feature file.

## Baseline preconditions

- Launch at `<url>` with a disposable data directory.
- Seed: `<seed data>`.
- Run `scripts/doctor.sh` and require the expected URL and data directory.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Treat every command as literal.
- Restore seeded data after a mutation. Keep proof artifacts.

## Proof

- UI: an accessibility snapshot and a screenshot with the app identity visible.
- CLI or API: the command, stdout, stderr, and exit code.
- Mutations: a second, read-only view of the stored value.

## Features

- [Login](./login.md)

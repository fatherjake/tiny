# Feature

1. **Understand the area.** Read the code and docs that the change touches. Note the conventions you must follow.
2. **Shape the data first.** Decide the core types and where state lives before writing logic (`principals/type-system-discipline.md`). Where the design is unclear, sketch two options and pick one with a stated reason.
3. **Break it into small units**, each ending in something you can check. Do them in order and check each before the next.
4. **Build.** Prefer deleting and reusing over adding (`principals/laziness-protocol.md`, `principals/subtract-before-you-add.md`). Add tests that call the code the way users do.
5. **Verify on the real surface** with the project's `verify-*` skill. Add or update its feature file if you added a user-facing path.
6. Run `playbooks/ship.md`.

**Reply:** what you built, key choices and why, and anything left open.

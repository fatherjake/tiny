---
status: planned   # planned | in-progress | complete | abandoned
slug: <slug>
created: <YYYY-MM-DD>   # from `date +%F`, never guessed
targets: []             # packages, services, or apps this touches
tickets: []             # optional, in landing order
---

# <Task title>

## Goal

Two or three lines. What is true when this is done, and who benefits.

## Exit condition

One checkable line. Example: "all units merged and `verify-web-app` login and borrow features pass".

## Context

Files, docs, and decisions that matter. Link them. Note conventions to follow.

## Units

Do these in order. Check each before starting the next.

### 1. <outcome>

- **Change:** what to do, in files or components.
- **Check:** the exact command, test, or observation that proves it.
- **Depends on:** earlier units, if any.

### 2. <outcome>

- **Change:**
- **Check:**

## Risks and unknowns

What could go wrong, and what you will do if it does. Mark anything irreversible (migrations, deploys, money).

## Out of scope

What this task deliberately does not do.

---
name: python
description: Python best practices for this repo, including writing compact code that stays readable. Use when reading or editing any .py file.
paths: ["**/*.py"]
---

# Python best practices

Read `../saiyan/principals/type-system-discipline.md` first. Every file in `core/` must stay under 1,000 lines (`scripts/check_loc.py`), so the second half of this skill is about saying more in fewer lines without making the code worse.

## Types

| Rule | Summary |
|------|---------|
| Type everything | Annotate every function signature and every non-obvious attribute. Modern syntax: `list[int]`, `X \| None`, `from __future__ import annotations`. |
| Union of dataclasses | Model variants as a union of frozen dataclasses (`PlaceOrder \| CancelOrder`), not one class with optional fields or a `kind` string plus a dict. |
| Exhaustive `match` | `match` on the union and end with `case _: assert_never(x)` so the type checker flags a new variant. |
| `NewType` for primitives | `NodeId = NewType("NodeId", int)` when two ints mean different things and mixing them would be a real bug. Not by reflex. |
| Frozen by default | `@dataclass(frozen=True, slots=True)` for messages and values. Mutable dataclasses only for state that is genuinely mutated. |
| Parse at the boundary | JSON, network bytes, CLI args and env vars are untrusted. Parse once into types (in `api.py` or `net.py`), trust the types inside. |
| No `Any`, no `cast` | `object` for truly unknown input, then narrow with `isinstance` or `match`. A `cast` needs a comment proving it. |
| `Protocol` over base classes | For interfaces like `Transport`, define a `Protocol`. No abstract base class hierarchies. |

## Compact, not clever

Fewer lines is the goal only when the code reads at least as well. Optimise for the reader, then for lines.

| Do | Don't |
|----|-------|
| Dataclasses, `field(default_factory=...)` and `__post_init__` instead of hand-written `__init__` | Rewriting `__init__`, `__eq__` and `__repr__` by hand |
| A comprehension for one transform or filter | Nested comprehensions, or a comprehension with side effects |
| Early `return` / `continue` guard clauses to flatten nesting | Deep `if`/`else` pyramids |
| `match` on message types for dispatch | Long `if isinstance(...) elif isinstance(...)` chains |
| `dict.setdefault`, `defaultdict`, `Counter`, `bisect`, `heapq`, `itertools`, `functools.cache` | Re-implementing the standard library |
| A dispatch dict or `getattr(self, f"on_{kind}")` when it removes a real chain of branches | Metaprogramming, decorators or descriptors that hide control flow |
| One small helper when the same 3+ lines appear twice | A helper called once, or a "utils" grab bag |
| Delete dead code, unused params and speculative options | Config flags and hooks nobody uses yet |
| A one-line docstring on non-obvious functions | Comments that restate the code, or banner comments padding a file |

Hard limits on compression:

- Never put several statements on one line with `;`, never chain walrus operators, and never cram a conditional expression inside another.
- A line over 100 characters (ruff's limit) is a sign to split the logic, not to wrap it cleverly.
- Readable names always beat shorter names. `quorum`, not `q`, except loop indices and well-known maths (`n`, `f`).
- If a reviewer would need to stop and decode a line, expand it. Saving a line is never worth that.
- Never dodge the limit by moving logic into `core/types.py` (data only) or into `sim/` (not part of the chain).

## Determinism (core/state.py, core/book.py, core/consensus.py)

- Integers only for money, prices and sizes. No `float`, ever. Use the scales in `core/types.py`.
- No wall clock, no `random`, no I/O inside state transitions. Use block timestamps and inputs.
- Iterate in a defined order. Sort keys before iterating a dict or set when the order affects output or hashing.
- Canonical encoding for anything hashed or signed. Never `repr()` or `pickle` for hashes.

## Tests and tooling

- `uv run pytest`, `uv run ruff check .`, `uv run ruff format .`, `uv run python scripts/check_loc.py`.
- Test behaviour through the real objects: spin up a `tests/cluster.py` cluster rather than mocking the replica.
- Run from the repo root. One validator is `python -m core`. A component module is `python -m core.<name>`, and the playground is `python -m sim`. Running a file directly makes `core/types.py` shadow the standard library.
- Use `logging` with context (node id, view, block hash prefix), not `print`, in `core/`.

Examples: `references/patterns.md`.

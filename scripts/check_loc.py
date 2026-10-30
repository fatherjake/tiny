"""Fail if any file in core/ or sim/ is 1,000 lines or longer."""

import sys
from pathlib import Path

LIMIT = 1000

bad = []
root = Path(__file__).resolve().parent.parent
for path in sorted([*root.joinpath("core").iterdir(), *root.joinpath("sim").iterdir()]):
    if path.suffix in {".py", ".html"}:
        lines = len(path.read_text().splitlines())
        print(f"{lines:5d}  {path.parent.name}/{path.name}")
        if lines >= LIMIT:
            bad.append(path.name)

if bad:
    sys.exit(f"over {LIMIT} lines: {', '.join(bad)}")

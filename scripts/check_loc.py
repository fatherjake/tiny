"""Fail if any component file in tiny/ is 1,000 lines or longer."""

import sys
from pathlib import Path

LIMIT = 1000

bad = []
for path in sorted(Path(__file__).resolve().parent.parent.joinpath("tiny").iterdir()):
    if path.suffix in {".py", ".html"}:
        lines = len(path.read_text().splitlines())
        print(f"{lines:5d}  {path.name}")
        if lines >= LIMIT:
            bad.append(path.name)

if bad:
    sys.exit(f"over {LIMIT} lines: {', '.join(bad)}")

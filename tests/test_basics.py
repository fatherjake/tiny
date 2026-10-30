import subprocess
import sys
from pathlib import Path


def test_every_file_under_limit():
    script = Path(__file__).resolve().parent.parent / "scripts" / "check_loc.py"
    subprocess.run([sys.executable, str(script)], check=True)


def test_quorum_math():
    from core.consensus import num_faulty, quorum_size

    assert [num_faulty(n) for n in (4, 7, 10)] == [1, 2, 3]
    assert [quorum_size(n) for n in (4, 7, 10)] == [3, 5, 7]

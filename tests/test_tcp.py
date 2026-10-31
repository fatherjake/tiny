"""Four validators on four TCP ports commit one chain. The sim stays on MemoryNetwork."""

from __future__ import annotations

import asyncio
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

from core.net import TcpTransport
from core.node import Node, public_key
from core.types import Market

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
ROOT = Path(__file__).resolve().parents[1]


def test_four_tcp_nodes_commit_one_state() -> None:
    asyncio.run(_four_nodes())


async def _four_nodes() -> None:
    transports = [TcpTransport(i, {}, ("127.0.0.1", 0)) for i in range(4)]
    await asyncio.gather(*(transport.bind() for transport in transports))
    bound = {transport.node_id: transport.address for transport in transports}
    for transport in transports:
        transport.peers = {i: addr for i, addr in bound.items() if i != transport.node_id}
    keys = [(i + 1).to_bytes(32, "big") for i in range(4)]
    pubs = {i: public_key(key) for i, key in enumerate(keys)}
    nodes = [Node(i, 4, keys[i], pubs, [MARKET], transports[i]) for i in range(4)]
    for node in nodes:
        node.start()
    for transport in transports:
        transport.start_dialing()
    try:
        await _until(lambda: _agreed(nodes, 5))
        assert _agreed(nodes, 5)
        before = min(len(node.committed) for node in nodes)
        writer = next(iter(transports[0]._conns.values()))
        writer.close()
        await _until(lambda: min(len(node.committed) for node in nodes) > before + 2)
        assert min(len(node.committed) for node in nodes) > before + 2
        assert len({node.state.state_root() for node in nodes}) == 1
    finally:
        for node in nodes:
            node.stop()
        await asyncio.gather(*(transport.close() for transport in transports))


def test_cli_validators_commit_on_their_own_ports(tmp_path: Path) -> None:
    keys = [(i + 1).to_bytes(32, "big") for i in range(4)]
    config = {
        "markets": [
            {
                "name": MARKET.name,
                "tick_size": MARKET.tick_size,
                "lot_size": MARKET.lot_size,
                "max_leverage": MARKET.max_leverage,
                "maintenance_margin_bps": MARKET.maintenance_margin_bps,
            }
        ],
        "validators": [
            {
                "id": i,
                "host": "127.0.0.1",
                "port": _free_port(),
                "public_key": public_key(key).hex(),
            }
            for i, key in enumerate(keys)
        ],
    }
    path = tmp_path / "cluster.json"
    path.write_text(json.dumps(config))
    key_paths = []
    for i, key in enumerate(keys):
        key_path = tmp_path / f"key{i}.hex"
        key_path.write_text(key.hex() + "\n")
        key_paths.append(key_path)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    lines: list[list[str]] = [[] for _ in keys]
    procs: list[subprocess.Popen[str]] = []
    for i, key_path in enumerate(key_paths):
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "core.node",
                "--id",
                str(i),
                "--config",
                str(path),
                "--key-file",
                str(key_path),
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        procs.append(proc)
        threading.Thread(target=_read, args=(proc, lines[i]), daemon=True).start()
    try:
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            heights = [_height(bucket) for bucket in lines]
            alive = [proc.poll() is None for proc in procs]
            if min(heights) > 5 and all(alive):
                break
            time.sleep(0.05)
        heights = [_height(bucket) for bucket in lines]
        assert [proc.poll() for proc in procs] == [None, None, None, None], lines
        assert min(heights) > 5, heights
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


def _agreed(nodes: list[Node], height: int) -> bool:
    heights = [len(node.committed) for node in nodes]
    roots = {node.state.state_root() for node in nodes}
    return min(heights) > height and len(roots) == 1


async def _until(ready: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if ready():
            return
        await asyncio.sleep(0.05)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _read(proc: subprocess.Popen[str], bucket: list[str]) -> None:
    assert proc.stdout is not None
    bucket.extend(proc.stdout)


def _height(bucket: list[str]) -> int:
    found = 0
    for line in bucket:
        match = re.search(r"commit height (\d+)", line)
        if match:
            found = max(found, int(match.group(1)))
    return found

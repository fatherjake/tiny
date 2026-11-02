"""Run one validator over TCP: python -m core --id N --config cluster.json --key-file key."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from pathlib import Path

from core.net import TcpTransport
from core.node import Node, public_key
from core.store import SqliteStore
from core.types import Market, NodeId


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one tiny validator over TCP")
    parser.add_argument("--id", type=int, required=True)
    parser.add_argument("--config", required=True, help="cluster.json: validators and markets")
    parser.add_argument("--key-file", required=True, help="hex ed25519 private key for --id")
    parser.add_argument(
        "--db", default="", help="sqlite file for the block log and history indexes"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        markets, peers, pubs = _cluster(Path(args.config))
        private_key = _private_key(Path(args.key_file))
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    if args.id not in peers:
        raise SystemExit(f"validator {args.id} is not in the config")
    if public_key(private_key) != pubs[args.id]:
        raise SystemExit(f"key file does not match validator {args.id}")
    others = {i: addr for i, addr in peers.items() if i != args.id}
    transport = TcpTransport(args.id, others, peers[args.id])
    store = None
    if args.db:
        validators = {pub.hex() for pub in pubs.values()}
        validators.add(public_key(private_key).hex())
        store = SqliteStore(args.db, markets, validators)
    node = Node(args.id, len(peers), private_key, pubs, markets, transport, store=store)
    try:
        asyncio.run(_serve(node, transport))
    except KeyboardInterrupt:
        return
    finally:
        if isinstance(node.store, SqliteStore):
            node.store.close()


async def _serve(node: Node, transport: TcpTransport) -> None:
    await transport.serve()
    node.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        node.stop()
        await transport.close()


def _cluster(
    path: Path,
) -> tuple[list[Market], dict[NodeId, tuple[str, int]], dict[NodeId, bytes]]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise TypeError("config must be an object")
    markets = [_market(item) for item in _list(raw.get("markets"), "markets")]
    validators = [_validator(item) for item in _list(raw.get("validators"), "validators")]
    ids = [item[0] for item in validators]
    if sorted(ids) != list(range(len(ids))):
        raise ValueError("validator ids must be 0..n-1")
    peers = {node_id: (host, port) for node_id, host, port, _pub in validators}
    pubs = {node_id: pub for node_id, _host, _port, pub in validators}
    return markets, peers, pubs


def _validator(value: object) -> tuple[int, str, int, bytes]:
    raw = _obj(value, "validator")
    port = _int(raw.get("port"), "port")
    if not 0 < port < 65536:
        raise ValueError("port must be 1..65535")
    return (
        _int(raw.get("id"), "id"),
        _str(raw.get("host"), "host"),
        port,
        _hex32(raw.get("public_key"), "public_key"),
    )


def _market(value: object) -> Market:
    raw = _obj(value, "market")
    return Market(
        _str(raw.get("name"), "name"),
        _int(raw.get("tick_size"), "tick_size"),
        _int(raw.get("lot_size"), "lot_size"),
        _int(raw.get("max_leverage"), "max_leverage"),
        _int(raw.get("maintenance_margin_bps"), "maintenance_margin_bps"),
    )


def _private_key(path: Path) -> bytes:
    return _hex32(path.read_text().strip(), "private key")


def _obj(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError(f"{name} must be an object")
    out: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError(f"{name} has a non-string key")
        out[key] = item
    return out


def _list(value: object, name: str) -> list[object]:
    if not isinstance(value, list):
        raise TypeError(f"{name} must be a list")
    return list(value)


def _int(value: object, name: str) -> int:
    if type(value) is not int:
        raise ValueError(f"{name} must be an int")
    return value


def _str(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a string")
    return value


def _hex32(value: object, name: str) -> bytes:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be hex")
    try:
        raw = bytes.fromhex(value.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be hex") from exc
    if len(raw) != 32:
        raise ValueError(f"{name} must be 32 bytes")
    return raw


if __name__ == "__main__":
    main()

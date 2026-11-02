"""
    TCP Transport

    node-to-node transport: it keeps a TCP connection open to every peer on the asyncio loop, redialling any that drop. 
    Note: There's no encryption or peer authentication; the node only trusts what the message signatures prove.
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from pydantic import ConfigDict, RootModel, ValidationError

from core.types import (
    NewView,
    NodeId,
    Proposal,
    Snapshot,
    SyncBlocks,
    SyncRequest,
    Timeout,
    Tx,
    Vote,
    canonical,
)

log = logging.getLogger(__name__)

Handler = Callable[[NodeId, object], None]
MAX_FRAME = 16 * 1024 * 1024
_RETRY_S = 0.2
_QUEUE = 128
_JSON = ConfigDict(strict=True, val_json_bytes="hex", ser_json_bytes="hex")


@dataclass(frozen=True)
class Hello:
    id: int


def _model(cls: type):
    class Model(RootModel[cls]):
        model_config = _JSON

    return Model


_KINDS: dict[type[object], str] = {
    Hello: "hello",
    Tx: "tx",
    Proposal: "proposal",
    Vote: "vote",
    Timeout: "timeout",
    NewView: "new_view",
    SyncRequest: "sync_request",
    Snapshot: "snapshot",
    SyncBlocks: "sync_blocks",
}
_MODELS = {kind: _model(cls) for cls, kind in _KINDS.items()}


class Transport(Protocol):
    def send(self, to: NodeId, msg: object) -> None: ...
    def broadcast(self, msg: object) -> None: ...
    def on_message(self, handler: Handler) -> None: ...


class TcpTransport:
    def __init__(
        self,
        node_id: NodeId,
        peers: dict[NodeId, tuple[str, int]],
        listen: tuple[str, int],
    ) -> None:
        self.node_id = node_id
        self.peers = dict(peers)
        self._host, self._port = listen
        self.address = listen
        self._handler: Handler | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: asyncio.Server | None = None
        self._conns: dict[NodeId, asyncio.StreamWriter] = {}
        self._outbox: dict[NodeId, deque[bytes]] = {}
        self._timers: dict[int, asyncio.TimerHandle] = {}
        self._tasks: list[asyncio.Task[None]] = []
        self._seq = 0
        self._dialing = False
        self._stopping = False

    def send(self, to: NodeId, msg: object) -> None:
        if to == self.node_id:
            self.call_later(0, lambda message=msg: self._deliver(self.node_id, message))
            return
        if to not in self.peers:
            return
        frame = _frame(msg)
        writer = self._conns.get(to)
        if writer is None:
            self._outbox.setdefault(to, deque(maxlen=_QUEUE)).append(frame)
            return
        writer.write(frame)

    def broadcast(self, msg: object) -> None:
        self.send(self.node_id, msg)
        for peer in self.peers:
            self.send(peer, msg)

    def on_message(self, handler: Handler) -> None:
        self._handler = handler

    def call_later(self, delay_ms: int, fn: Callable[[], None]) -> int:
        if self._loop is None:
            raise RuntimeError("transport is not serving")
        self._seq += 1
        token = self._seq
        self._timers[token] = self._loop.call_later(delay_ms / 1000, self._fire, token, fn)
        return token

    def cancel(self, token: int) -> None:
        handle = self._timers.pop(token, None)
        if handle is not None:
            handle.cancel()

    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000

    async def bind(self) -> None:
        """Listen. The bound address is `self.address` (port 0 becomes the real port)."""
        if self._server is not None:
            return
        self._loop = asyncio.get_running_loop()
        self._server = await asyncio.start_server(self._on_accept, self._host, self._port)
        sock = self._server.sockets[0]
        host, port, *_rest = sock.getsockname()
        self.address = (str(host), int(port))

    def start_dialing(self) -> None:
        if self._dialing or self._loop is None:
            return
        self._dialing = True
        for peer, (host, port) in self.peers.items():
            if peer > self.node_id:
                self._tasks.append(self._loop.create_task(self._dial(peer, host, port)))

    async def serve(self) -> None:
        """Bind, then dial every higher id. Peers must already be set."""
        await self.bind()
        self.start_dialing()
        log.info("node %d listening on %s:%d", self.node_id, self.address[0], self.address[1])

    async def close(self) -> None:
        self._stopping = True
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        for handle in self._timers.values():
            handle.cancel()
        self._timers.clear()
        for writer in self._conns.values():
            writer.close()
        self._conns.clear()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    def _fire(self, token: int, fn: Callable[[], None]) -> None:
        self._timers.pop(token, None)
        fn()

    def _deliver(self, sender: NodeId, msg: object) -> None:
        if self._handler is None:
            return
        self._handler(sender, msg)

    def _register(self, peer: NodeId, writer: asyncio.StreamWriter) -> None:
        previous = self._conns.get(peer)
        if previous is not None and previous is not writer:
            previous.close()
        self._conns[peer] = writer
        queued = self._outbox.pop(peer, deque())
        for frame in queued:
            writer.write(frame)

    def _drop(self, peer: NodeId, writer: asyncio.StreamWriter) -> None:
        if self._conns.get(peer) is writer:
            self._conns.pop(peer, None)

    async def _dial(self, peer: NodeId, host: str, port: int) -> None:
        while not self._stopping:
            writer: asyncio.StreamWriter | None = None
            try:
                _reader, writer = await asyncio.open_connection(host, port)
                _nodelay(writer)
                await self._session(writer, _reader, expect=peer)
            except asyncio.CancelledError:
                raise
            except (
                OSError,
                EOFError,
                TypeError,
                ValueError,
                ValidationError,
                json.JSONDecodeError,
            ):
                pass
            finally:
                if writer is not None:
                    writer.close()
                    self._drop(peer, writer)
            await asyncio.sleep(_RETRY_S)

    async def _on_accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        _nodelay(writer)
        try:
            await self._session(writer, reader, expect=None)
        except asyncio.CancelledError:
            raise
        except (OSError, EOFError, TypeError, ValueError, ValidationError, json.JSONDecodeError):
            pass
        finally:
            writer.close()

    async def _session(
        self,
        writer: asyncio.StreamWriter,
        reader: asyncio.StreamReader,
        expect: NodeId | None,
    ) -> None:
        writer.write(_frame(Hello(self.node_id)))
        await writer.drain()
        buf = bytearray()
        hello = _message(await _read_frame(reader, buf))
        if not isinstance(hello, Hello):
            return
        peer = hello.id
        if expect is None:
            if peer not in self.peers or peer > self.node_id:
                return
        elif peer != expect:
            return
        self._register(peer, writer)
        try:
            while not self._stopping:
                msg = _message(await _read_frame(reader, buf))
                if isinstance(msg, Hello):
                    continue
                try:
                    self._deliver(peer, msg)
                except Exception:
                    log.exception("node %d: message from %d failed", self.node_id, peer)
                    return
                transport = writer.transport
                if transport is not None and transport.get_write_buffer_size() > 1 << 20:
                    await writer.drain()
        finally:
            self._drop(peer, writer)


def _frame(msg: object) -> bytes:
    kind = _KINDS.get(type(msg))
    if kind is None:
        raise TypeError(f"cannot send {type(msg).__name__}")
    payload = json.dumps(
        {"body": canonical(msg), "kind": kind}, sort_keys=True, separators=(",", ":")
    ).encode()
    if len(payload) > MAX_FRAME:
        raise ValueError("message too large")
    return len(payload).to_bytes(4, "big") + payload


def _message(payload: bytes) -> object:
    raw = json.loads(payload)
    if not isinstance(raw, dict):
        raise TypeError("frame")
    kind = raw.get("kind")
    if not isinstance(kind, str) or "body" not in raw:
        raise TypeError("frame")
    model = _MODELS.get(kind)
    if model is None:
        raise ValueError("frame")
    return model.model_validate_json(json.dumps(raw["body"]).encode()).root


async def _read_frame(reader: asyncio.StreamReader, buf: bytearray) -> bytes:
    while len(buf) < 4:
        chunk = await reader.read(65536)
        if not chunk:
            raise EOFError
        buf.extend(chunk)
    size = int.from_bytes(buf[:4], "big")
    if size <= 0 or size > MAX_FRAME:
        raise ValueError("bad frame length")
    need = 4 + size
    while len(buf) < need:
        chunk = await reader.read(65536)
        if not chunk:
            raise EOFError
        buf.extend(chunk)
    payload = bytes(buf[4:need])
    del buf[:need]
    return payload


def _nodelay(writer: asyncio.StreamWriter) -> None:
    sock = writer.get_extra_info("socket")
    if isinstance(sock, socket.socket):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

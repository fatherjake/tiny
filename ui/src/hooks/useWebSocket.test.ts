import { act, cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WsMessage } from "../types";
import { useWebSocket } from "./useWebSocket";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    act(() => this.onopen?.());
  }
  send(data: unknown) {
    act(() => this.onmessage?.({ data }));
  }
  drop() {
    act(() => this.onclose?.());
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

function connect(path = "/ws") {
  const got: WsMessage[] = [];
  const hook = renderHook(
    ({ path }) => useWebSocket(path, (msg) => got.push(msg)),
    { initialProps: { path } },
  );
  return { ...hook, got };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const block = { type: "block", height: 1, hash: "aa", view: 0 } as const;
const book = { type: "book", market: "BTC", best_bid: 1 } as const;
const trade = {
  type: "trade",
  seq: 1,
  height: 1,
  timestamp_ms: 0,
  market: "BTC",
  side: "buy",
  price: 1,
  size: 1,
} as const;

describe("useWebSocket", () => {
  it("connects to the page host and goes live once open", () => {
    const { result } = connect("/ws");
    expect(latest().url).toBe("ws://" + location.host + "/ws");
    expect(result.current).toBe("connecting");
    latest().open();
    expect(result.current).toBe("live");
  });

  it("uses wss when the page is served over https", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "tiny.example" });
    connect("/feed");
    expect(latest().url).toBe("wss://tiny.example/feed");
  });

  it("delivers block, book and trade frames and drops everything else", () => {
    const { got } = connect();
    const socket = latest();
    socket.open();
    socket.send(JSON.stringify(block));
    socket.send("not json");
    socket.send("42");
    socket.send("null");
    socket.send(JSON.stringify({ hello: 1 }));
    socket.send(JSON.stringify({ type: "ping" }));
    socket.send(JSON.stringify(book));
    socket.send(JSON.stringify(trade));
    expect(got).toEqual([block, book, trade]);
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ["ws: dropped unrecognised frame", "not json"],
      ["ws: dropped unrecognised frame", "42"],
      ["ws: dropped unrecognised frame", "null"],
      ["ws: dropped unrecognised frame", '{"hello":1}'],
      ["ws: dropped unrecognised frame", '{"type":"ping"}'],
    ]);
  });

  it("reports a handler that throws and keeps delivering later frames", () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (err: unknown) => reported.push(err));
    const boom = new Error("handler broke");
    let calls = 0;
    renderHook(() =>
      useWebSocket("/ws", () => {
        calls += 1;
        if (calls === 1) throw boom;
      }),
    );
    latest().send(JSON.stringify(block));
    latest().send(JSON.stringify(block));
    expect(reported).toEqual([boom]);
    expect(calls).toBe(2);
  });

  it("calls the newest handler without reconnecting", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ tag }) => useWebSocket("/ws", (msg) => seen.push(tag + msg.type)),
      { initialProps: { tag: "a:" } },
    );
    latest().send(JSON.stringify(block));
    rerender({ tag: "b:" });
    latest().send(JSON.stringify(book));
    expect(seen).toEqual(["a:block", "b:book"]);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("reconnects with doubling delays capped at 8s, resetting after a successful open", () => {
    const { result } = connect();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = FakeSocket.all.length;
      latest().drop();
      expect(result.current).toBe("reconnecting");
      let waited = 0;
      while (FakeSocket.all.length === before) {
        act(() => vi.advanceTimersByTime(100));
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    latest().open();
    expect(result.current).toBe("live");
    latest().drop();
    act(() => vi.advanceTimersByTime(499));
    expect(FakeSocket.all).toHaveLength(7);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.all).toHaveLength(8);
  });

  it("closes the socket on unmount and never reconnects", () => {
    const { unmount } = connect();
    const socket = latest();
    socket.open();
    unmount();
    expect(socket.closed).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("cancels a pending reconnect on unmount", () => {
    const { unmount } = connect();
    latest().drop();
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("opens a fresh socket when the path changes", () => {
    const { rerender } = connect("/a");
    const first = latest();
    rerender({ path: "/b" });
    expect(first.closed).toBe(true);
    expect(FakeSocket.all.map((s) => s.url)).toEqual([
      "ws://" + location.host + "/a",
      "ws://" + location.host + "/b",
    ]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("waits min(500 * 2^failures, 8000) ms after any mix of drops and opens", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 15 }), (opens) => {
        FakeSocket.all = [];
        const { unmount } = connect();
        let failures = 0;
        for (const opened of opens) {
          if (opened) {
            latest().open();
            failures = 0;
          }
          const count = FakeSocket.all.length;
          latest().drop();
          const delay = Math.min(500 * 2 ** failures, 8000);
          act(() => vi.advanceTimersByTime(delay - 1));
          expect(FakeSocket.all).toHaveLength(count);
          act(() => vi.advanceTimersByTime(1));
          expect(FakeSocket.all).toHaveLength(count + 1);
          failures += 1;
        }
        unmount();
      }),
    );
  });
});

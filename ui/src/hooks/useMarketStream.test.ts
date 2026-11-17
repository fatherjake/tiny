import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markSent } from "../lib/latency";
import { flushTrades } from "../lib/stream";
import type { BlockMsg, Trade, WsMessage } from "../types";
import { useMarketStream } from "./useMarketStream";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {}
}

const T0 = 1_700_000_000_000;

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(T0);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stream() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useMarketStream(), { wrapper });
  const socket = FakeSocket.all[FakeSocket.all.length - 1];
  const push = (...msgs: WsMessage[]) =>
    act(() => {
      for (const msg of msgs) socket.onmessage?.({ data: JSON.stringify(msg) });
      flushTrades(client);
    });
  const pushLive = (...msgs: WsMessage[]) =>
    act(() => {
      for (const msg of msgs) socket.onmessage?.({ data: JSON.stringify(msg) });
    });
  const stale = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated ?? null;
  return { ...hook, client, socket, push, pushLive, stale };
}

const block = (height: number, extra: Partial<BlockMsg> = {}): BlockMsg => ({
  type: "block",
  height,
  hash: "h" + height,
  view: height * 10,
  ...extra,
});

const print = (seq: number, market = "BTC"): Trade => ({
  seq,
  height: 1,
  timestamp_ms: seq,
  market,
  side: "buy",
  price: "100",
  size: "1",
});

describe("useMarketStream", () => {
  it("reports the socket state", () => {
    const { result, socket } = stream();
    expect(socket.url).toBe("ws://" + location.host + "/ws");
    expect(result.current).toBe("connecting");
    act(() => socket.onopen?.());
    expect(result.current).toBe("live");
  });

  it("records each block in the feed, newest first, keeping the last 50", () => {
    const { client, push } = stream();
    push(block(1));
    expect(client.getQueryData(["stream", "feed"])).toEqual([block(1)]);
    for (let h = 2; h <= 60; h++) push(block(h));
    const feed = client.getQueryData<BlockMsg[]>(["stream", "feed"]);
    expect(feed?.map((b) => b.height)).toEqual(
      Array.from({ length: 50 }, (_, i) => 60 - i),
    );
  });

  it("stamps the arrival time of the latest block", () => {
    const { client, push } = stream();
    push(block(1));
    expect(client.getQueryData(["stream", "lastBlock"])).toBe(T0);
    vi.setSystemTime(T0 + 1234);
    push(block(2));
    expect(client.getQueryData(["stream", "lastBlock"])).toBe(T0 + 1234);
  });

  it("moves the chain tip in the status, keeping what the node reported", () => {
    const { client, push } = stream();
    push(block(3));
    expect(client.getQueryData(["market", "status"])).toEqual({
      height: 3,
      view: 30,
      tip: "h3",
    });
    client.setQueryData(["market", "status"], {
      node: 2,
      mempool: 5,
      rttMs: 9,
    });
    push(block(4));
    expect(client.getQueryData(["market", "status"])).toEqual({
      node: 2,
      mempool: 5,
      rttMs: 9,
      height: 4,
      view: 40,
      tip: "h4",
    });
  });

  it("times inclusion of our own transactions", () => {
    const { client, push } = stream();
    markSent("alice", 3);
    vi.advanceTimersByTime(420);
    push(block(1, { txs: [{ kind: "place_order", signer: "bob", nonce: 3 }] }));
    expect(client.getQueryData(["stream", "inclusion"])).toBe(undefined);
    push(
      block(2, { txs: [{ kind: "place_order", signer: "alice", nonce: 3 }] }),
    );
    expect(client.getQueryData(["stream", "inclusion"])).toBe(420);
    push(block(3));
    expect(client.getQueryData(["stream", "inclusion"])).toBe(420);
  });

  it("refreshes the market list on every block", () => {
    const { client, push, stale } = stream();
    client.setQueryData(["market", "list"], []);
    push(block(1));
    expect(stale(["market", "list"])).toBe(true);
    client.setQueryData(["market", "list"], []);
    push(block(2));
    expect(stale(["market", "list"])).toBe(true);
  });

  it("refreshes accounts at most once every 250ms of blocks", () => {
    const { client, push, stale } = stream();
    const view = ["account", "alice", "view"];
    const seen: boolean[] = [];
    for (const [ms, h] of [
      [0, 1],
      [100, 2],
      [249, 3],
      [250, 4],
      [400, 5],
      [500, 6],
    ]) {
      vi.setSystemTime(T0 + ms);
      client.setQueryData(view, { nonce: 1 });
      push(block(h));
      seen.push(stale(view) === true);
    }
    expect(seen).toEqual([true, false, false, true, false, true]);
  });

  it("stores each book under its market", () => {
    const { client, push } = stream();
    push({ type: "book", market: "BTC", best_bid: "1", best_ask: "2" });
    push({ type: "book", market: "ETH", best_bid: "3", best_ask: "4" });
    push({ type: "book", market: "BTC", best_bid: "5", best_ask: "6" });
    expect(client.getQueryData(["market", "books"])).toEqual({
      BTC: { type: "book", market: "BTC", best_bid: "5", best_ask: "6" },
      ETH: { type: "book", market: "ETH", best_bid: "3", best_ask: "4" },
    });
  });

  it("prepends new prints to loaded trades and ignores repeats", () => {
    const { client, push } = stream();
    client.setQueryData(["market", "trades", "BTC"], [print(1)]);
    push({ type: "trade", ...print(2) }, { type: "trade", ...print(2) });
    expect(client.getQueryData(["market", "trades", "BTC"])).toEqual([
      print(2),
      print(1),
    ]);
  });

  it("holds trades until the next frame, then lands them in one update", () => {
    const { client, pushLive } = stream();
    client.setQueryData(["market", "trades", "BTC"], [print(1)]);
    let updates = 0;
    const off = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated") updates++;
    });
    pushLive(
      { type: "trade", ...print(2) },
      { type: "trade", ...print(3) },
      { type: "trade", ...print(4) },
    );
    expect(client.getQueryData(["market", "trades", "BTC"])).toEqual([
      print(1),
    ]);
    act(() => flushTrades(client));
    off();
    expect(updates).toBe(1);
    expect(client.getQueryData(["market", "trades", "BTC"])).toEqual([
      print(4),
      print(3),
      print(2),
      print(1),
    ]);
  });

  it("leaves trades alone for a market whose history has not loaded", () => {
    const { client, push } = stream();
    client.setQueryData(["market", "trades", "BTC"], []);
    push({ type: "trade", ...print(1, "ETH") });
    push({ type: "trade", ...print(2, "BTC") });
    expect(client.getQueryData(["market", "trades", "ETH"])).toBe(undefined);
    expect(client.getQueryData(["market", "trades", "BTC"])).toEqual([
      print(2, "BTC"),
    ]);
  });

  it("keeps at most 2000 prints", () => {
    const { client, push } = stream();
    const old = Array.from({ length: 2000 }, (_, i) => print(2000 - i));
    client.setQueryData(["market", "trades", "BTC"], old);
    push({ type: "trade", ...print(2001) });
    const rows = client.getQueryData<Trade[]>(["market", "trades", "BTC"]);
    expect(rows?.length).toBe(2000);
    expect(rows?.[0].seq).toBe(2001);
    expect(rows?.[1999].seq).toBe(2);
  });

  it("resyncs markets and accounts when a block or trade is skipped", () => {
    const { client, push, stale } = stream();
    const books = ["market", "books"];
    const fills = ["account", "alice", "fills"];
    const reset = () => {
      client.setQueryData(books, {});
      client.setQueryData(fills, []);
    };
    reset();
    push(block(1), block(2));
    push({ type: "trade", ...print(1) }, { type: "trade", ...print(2) });
    expect([stale(books), stale(fills)]).toEqual([false, true]);
    reset();
    vi.setSystemTime(T0 + 100);
    push({ type: "trade", ...print(4) });
    expect([stale(books), stale(fills)]).toEqual([true, true]);
    reset();
    push(block(3));
    expect(stale(books)).toBe(false);
    push(block(5));
    expect(stale(books)).toBe(true);
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [
        "ws: missed frames, resyncing",
        { from: { height: 2, seq: 2 }, at: { type: "trade", ...print(4) } },
      ],
      [
        "ws: missed frames, resyncing",
        { from: { height: 3, seq: 4 }, at: block(5) },
      ],
    ]);
  });

  it("matches a newest-first, unique, capped model for any stream of prints", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 40 }), { maxLength: 30 }),
        (seeded, incoming) => {
          const { client, push, unmount } = stream();
          client.setQueryData(
            ["market", "trades", "BTC"],
            seeded.map((seq) => print(seq)),
          );
          let model = seeded.map((seq) => print(seq));
          for (const seq of incoming) {
            push({ type: "trade", ...print(seq) });
            if (!model.some((row) => row.seq === seq))
              model = [print(seq), ...model];
          }
          expect(client.getQueryData(["market", "trades", "BTC"])).toEqual(
            model,
          );
          unmount();
        },
      ),
    );
  });
});

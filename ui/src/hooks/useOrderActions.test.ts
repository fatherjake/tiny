import * as ed from "@noble/ed25519";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memorySigner, type Signer } from "../lib/keystore";
import { inclusionMs } from "../lib/latency";
import type { StoredOrder } from "../types";
import { useOrderActions } from "./useOrderActions";

const T0 = 1_700_000_000_000;
const FIRST_ID = T0 * 1000;
const SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

type Posted = {
  body: Record<string, unknown>;
  signer: string;
  nonce: number;
  sig: string;
};

let routes: Record<string, unknown> = {};
let asked: string[] = [];
let posted: Posted[] = [];
let replies: (() => Response | Promise<Response>)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(T0);
  routes = {};
  asked = [];
  posted = [];
  replies = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    asked.push(url);
    if (url === "/tx") {
      posted.push(JSON.parse(String(init?.body)));
      const reply = replies.shift();
      return reply ? reply() : new Response("{}");
    }
    if (!(url in routes)) return new Response("", { status: 404 });
    return new Response(JSON.stringify(routes[url]));
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const alice = () => memorySigner(SEED, "alice");

function account(trader: string, nonce: number) {
  routes["/account/" + trader] = { trader, collateral: "0", nonce };
}

function history(trader: string, rows: Partial<StoredOrder>[]) {
  routes["/accounts/" + trader + "/orders?status=history&limit=50"] = rows;
}

function actions(initial: Signer | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(({ key }) => useOrderActions(key), {
    wrapper,
    initialProps: { key: initial },
  });
  return { ...hook, client };
}

const order = {
  market: "BTC",
  side: "buy",
  type: "limit",
  price: 100_000_000n,
  size: 2_000_000n,
  reduce_only: false,
} as const;

const placed = (id: number, nonce: number, extra = {}) => ({
  body: {
    kind: "place_order",
    order: {
      id,
      trader: "alice",
      market: "BTC",
      side: "buy",
      type: "limit",
      price: 100000000,
      size: 2000000,
      reduce_only: false,
      ...extra,
    },
  },
  signer: "alice",
  nonce,
  sig: expect.stringMatching(/^[0-9a-f]{128}$/),
});

const rejectWith = (status: number, body: string) => () =>
  new Response(body, { status });

describe("useOrderActions", () => {
  it("starts at nonce 1 and a clock-based order id, and sends nothing without a key", async () => {
    const { result } = actions(null);
    expect(result.current.nonce).toBe(1);
    expect(result.current.orderId).toBe(FIRST_ID);
    await act(() => result.current.send(order));
    await act(() =>
      result.current.cancel({
        id: 1,
        market: "BTC",
        side: "buy",
        price: 1,
        size: 1,
      }),
    );
    expect(result.current).toMatchObject({
      pending: false,
      note: "",
      bad: false,
    });
    expect(posted).toEqual([]);
  });

  it("continues from the account's nonce", async () => {
    account("alice", 4);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(5));
  });

  it("signs and posts an order, then moves on to the next nonce and id", async () => {
    account("alice", 4);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(5));
    vi.advanceTimersByTime(30);
    await act(() => result.current.send(order));
    expect(posted).toEqual([placed(FIRST_ID, 5)]);
    expect(result.current).toMatchObject({
      pending: false,
      bad: false,
      note: "order " + FIRST_ID + " sent, waiting for a block",
      nonce: 6,
      orderId: FIRST_ID + 1,
    });
    const payload = new TextEncoder().encode(
      '[{"kind":"place_order","order":{"id":' +
        FIRST_ID +
        ',"market":"BTC","price":100000000,"reduce_only":false,"side":"buy","size":2000000,"trader":"alice","type":"limit"}},"alice",5]',
    );
    expect(
      await ed.verifyAsync(
        ed.etc.hexToBytes(posted[0].sig),
        payload,
        await ed.getPublicKeyAsync(SEED),
      ),
    ).toBe(true);
    vi.advanceTimersByTime(12);
    expect(
      inclusionMs([{ kind: "place_order", signer: "alice", nonce: 5 }]),
    ).toBe(12);
  });

  it("reports how the awaited order ended once it shows up in history", async () => {
    account("alice", 0);
    history("alice", []);
    const { result, client } = actions(alice());
    await act(() => result.current.send(order));
    await act(() => result.current.send(order));
    history("alice", [
      { order_id: FIRST_ID + 1, status: "rejected", reason: "margin" },
      { order_id: FIRST_ID, status: "filled", reason: "" },
    ]);
    await act(() =>
      client.refetchQueries({ queryKey: ["account", "alice", "history"] }),
    );
    await waitFor(() =>
      expect(result.current.note).toBe(
        "order " + (FIRST_ID + 1) + " rejected: not enough margin",
      ),
    );
    expect(result.current.bad).toBe(true);
  });

  it("reports a fill as good news", async () => {
    account("alice", 0);
    history("alice", []);
    const { result, client } = actions(alice());
    await act(() => result.current.send(order));
    history("alice", [{ order_id: FIRST_ID, status: "filled", reason: "" }]);
    await act(() =>
      client.refetchQueries({ queryKey: ["account", "alice", "history"] }),
    );
    await waitFor(() =>
      expect(result.current.note).toBe("order " + FIRST_ID + " filled"),
    );
    expect(result.current.bad).toBe(false);
  });

  it("resyncs the nonce from the chain after a 400 and forgets the latency mark", async () => {
    account("alice", 4);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(5));
    replies.push(rejectWith(400, '{"detail":"stale nonce"}'));
    account("alice", 9);
    await act(() => result.current.send(order));
    expect(result.current).toMatchObject({
      pending: false,
      bad: true,
      note: "stale nonce",
      nonce: 10,
      orderId: FIRST_ID,
    });
    expect(
      inclusionMs([{ kind: "place_order", signer: "alice", nonce: 5 }]),
    ).toBe(null);
    await act(() => result.current.send(order));
    expect(posted.map((p) => p.nonce)).toEqual([5, 10]);
  });

  it("keeps its nonce after a 400 when the chain has no account yet", async () => {
    const { result } = actions(alice());
    replies.push(rejectWith(400, '{"detail":"stale nonce"}'));
    await act(() => result.current.send(order));
    expect(asked.filter((u) => u === "/account/alice")).toHaveLength(2);
    expect(result.current.note).toBe("stale nonce");
    expect(result.current.nonce).toBe(1);
  });

  it("does not resync the nonce after a server error", async () => {
    account("alice", 4);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(5));
    const before = asked.length;
    replies.push(rejectWith(500, "node down"));
    account("alice", 9);
    await act(() => result.current.send(order));
    expect(asked.slice(before)).toEqual(["/tx"]);
    expect(result.current).toMatchObject({
      bad: true,
      note: "node down",
      nonce: 5,
    });
  });

  it("skips the resync for a key with no trader id", async () => {
    const { result } = actions(memorySigner(SEED, ""));
    replies.push(rejectWith(400, '{"detail":"signer"}'));
    await act(() => result.current.send(order));
    expect(asked).toEqual(["/tx"]);
    expect(result.current.note).toBe("signer");
  });

  it.each([
    ["a thrown string", "wallet locked", "wallet locked"],
    ["an error without a message", new Error(""), "Error"],
  ])("shows %s from the signer", async (_, err, shown) => {
    const { result } = actions({
      trader: "alice",
      sign: () => Promise.reject(err),
    });
    await act(() => result.current.send(order));
    expect(result.current).toMatchObject({ bad: true, note: shown });
    expect(posted).toEqual([]);
  });

  it("ignores new requests while one is in flight", async () => {
    account("alice", 0);
    const { result } = actions(alice());
    let release!: () => void;
    replies.push(
      () =>
        new Promise((res) => {
          release = () => res(new Response("{}"));
        }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.send(order);
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      await result.current.send(order);
      await result.current.cancel({
        id: 1,
        market: "BTC",
        side: "buy",
        price: 1,
        size: 1,
      });
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.pending).toBe(false);
    expect(posted).toHaveLength(1);
  });

  it("cancels an order with the next nonce", async () => {
    account("alice", 2);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(3));
    await act(() =>
      result.current.cancel({
        id: 77,
        market: "ETH",
        side: "sell",
        price: "5",
        size: "1",
      }),
    );
    expect(posted).toEqual([
      {
        body: {
          kind: "cancel_order",
          trader: "alice",
          market: "ETH",
          order_id: 77,
        },
        signer: "alice",
        nonce: 3,
        sig: expect.stringMatching(/^[0-9a-f]{128}$/),
      },
    ]);
    expect(result.current).toMatchObject({
      bad: false,
      note: "accepted nonce 3",
      nonce: 4,
    });
  });

  it("reports a refused cancel and keeps the nonce", async () => {
    account("alice", 2);
    const { result } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(3));
    replies.push(rejectWith(400, '{"detail":"no such order"}'));
    await act(() =>
      result.current.cancel({
        id: 77,
        market: "ETH",
        side: "sell",
        price: "5",
        size: "1",
      }),
    );
    expect(result.current).toMatchObject({
      bad: true,
      note: "no such order",
      nonce: 3,
    });
    expect(
      inclusionMs([{ kind: "cancel_order", signer: "alice", nonce: 3 }]),
    ).toBe(null);
  });

  it("closes a long with a reduce-only market sell 1% under the bid", async () => {
    const { result, client } = actions(alice());
    client.setQueryData(["market", "books"], {
      BTC: { best_bid: "100000000", best_ask: "101000000" },
    });
    await act(() =>
      result.current.close({
        market: "BTC",
        size: "3000000",
        entry_notional: "1",
      }),
    );
    expect(posted).toEqual([
      placed(FIRST_ID, 1, {
        side: "sell",
        type: "market",
        price: 99000000,
        size: 3000000,
        reduce_only: true,
      }),
    ]);
  });

  it("refuses to close without a quote on the other side", async () => {
    const { result, client } = actions(alice());
    await act(() =>
      result.current.close({ market: "BTC", size: "-1", entry_notional: "1" }),
    );
    expect(result.current).toMatchObject({
      bad: true,
      note: "no quote to close BTC against",
    });
    client.setQueryData(["market", "books"], { BTC: { best_bid: "5" } });
    await act(() =>
      result.current.close({ market: "BTC", size: "-1", entry_notional: "1" }),
    );
    expect(result.current.note).toBe("no quote to close BTC against");
    expect(posted).toEqual([]);
  });

  it("starts over when the key changes", async () => {
    account("alice", 4);
    const { result, rerender } = actions(alice());
    await waitFor(() => expect(result.current.nonce).toBe(5));
    await act(() => result.current.send(order));
    replies.push(rejectWith(500, "down"));
    await act(() => result.current.send(order));
    expect(result.current).toMatchObject({ nonce: 6, bad: true, note: "down" });
    rerender({ key: alice() });
    expect(result.current).toMatchObject({ nonce: 5, bad: false, note: "" });
  });

  it("never reuses an accepted nonce, whatever the chain reports in between", async () => {
    type Op =
      | { kind: "ok" }
      | { kind: "stale"; fresh: number }
      | { kind: "down" }
      | { kind: "poll"; nonce: number };
    const op: fc.Arbitrary<Op> = fc.oneof(
      fc.constant({ kind: "ok" as const }),
      fc.record({
        kind: fc.constant("stale" as const),
        fresh: fc.nat({ max: 20 }),
      }),
      fc.constant({ kind: "down" as const }),
      fc.record({
        kind: fc.constant("poll" as const),
        nonce: fc.nat({ max: 20 }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 20 }),
        fc.array(op, { maxLength: 8 }),
        async (start, ops) => {
          posted = [];
          replies = [];
          account("alice", start);
          const { result, client, unmount } = actions(alice());
          await waitFor(() => expect(result.current.nonce).toBe(start + 1));
          let local = 0;
          let chain = start;
          const accepted: number[] = [];
          for (const step of ops) {
            if (step.kind === "poll") {
              account("alice", step.nonce);
              act(() => {
                client.setQueryData(["account", "alice", "view"], {
                  trader: "alice",
                  collateral: "0",
                  nonce: step.nonce,
                });
              });
              chain = step.nonce;
              continue;
            }
            const expected = Math.max(local, chain) + 1;
            await waitFor(() => expect(result.current.nonce).toBe(expected));
            if (step.kind === "stale") {
              replies.push(rejectWith(400, "stale"));
              account("alice", step.fresh);
            }
            if (step.kind === "down") replies.push(rejectWith(500, "down"));
            await act(() => result.current.send(order));
            expect(posted.at(-1)?.nonce).toBe(expected);
            if (step.kind === "ok") {
              local = expected;
              accepted.push(expected);
            }
            if (step.kind === "stale") {
              local = Math.max(local, step.fresh);
              chain = step.fresh;
            }
          }
          for (let i = 1; i < accepted.length; i++)
            expect(accepted[i]).toBeGreaterThan(accepted[i - 1]);
          unmount();
        },
      ),
      { numRuns: 30 },
    );
  });
});

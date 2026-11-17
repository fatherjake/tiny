import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketInfo } from "../types";
import {
  useBook,
  useFeed,
  useFunding,
  useInclusionMs,
  useLastBlockAt,
  useMarket,
  useMarkets,
  useMarketsSelect,
  useSeries,
  useStatus,
  useTrades,
} from "./useMarket";

let routes: Record<string, unknown> = {};
let asked: string[] = [];

beforeEach(() => {
  routes = {};
  asked = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (!(url in routes)) return new Response("", { status: 404 });
    return new Response(JSON.stringify(routes[url]));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function render<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(hook, { wrapper });
}

const market = (name: string, max_leverage = 10): MarketInfo => ({
  name,
  tick_size: "1",
  lot_size: "1",
  max_leverage,
  maintenance_margin_bps: 500,
  oracle_price: null,
  mark_price: null,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
});

const stored = (id: number, height: number, price: string) => ({
  id,
  height,
  tx_index: 0,
  market: "BTC",
  price,
  size: "1000000",
  taker: "a",
  maker: "b",
  side: "buy",
  liquidation: false,
  ts: height * 1000,
});

describe("useStatus", () => {
  it("is null until the node answers, then carries the round trip time", async () => {
    routes["/status"] = { node: 1, height: 7, view: 2, tip: "ab" };
    const { result } = render(() => useStatus());
    expect(result.current).toBe(null);
    await waitFor(() =>
      expect(result.current).toEqual({
        node: 1,
        height: 7,
        view: 2,
        tip: "ab",
        rttMs: expect.any(Number),
      }),
    );
  });
});

describe("markets", () => {
  it("lists markets, starting empty", async () => {
    routes["/markets"] = [market("BTC"), market("ETH")];
    const { result } = render(() => useMarkets());
    expect(result.current).toEqual([]);
    await waitFor(() =>
      expect(result.current).toEqual([market("BTC"), market("ETH")]),
    );
  });

  it("runs a selector over the market list", async () => {
    routes["/markets"] = [market("BTC"), market("ETH")];
    const { result } = render(() =>
      useMarketsSelect((ms) => ms.map((m) => m.name).join(",")),
    );
    expect(result.current).toBe(undefined);
    await waitFor(() => expect(result.current).toBe("BTC,ETH"));
  });

  it("finds one market by name, or null", async () => {
    routes["/markets"] = [market("BTC", 5), market("ETH", 20)];
    const { result } = render(() => ({
      eth: useMarket("ETH"),
      sol: useMarket("SOL"),
    }));
    await waitFor(() => expect(result.current.eth).toEqual(market("ETH", 20)));
    expect(result.current.sol).toBe(null);
  });

  it("agrees with the first market of that name for any market list", async () => {
    const names = fc.constantFrom("BTC", "ETH", "SOL");
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(names, fc.integer({ min: 1, max: 50 }))),
        names,
        async (rows, name) => {
          const list = rows.map(([n, lev]) => market(n, lev));
          routes["/markets"] = list;
          let expected: MarketInfo | null = null;
          for (const m of list) {
            if (m.name === name) {
              expected = m;
              break;
            }
          }
          const { result, unmount } = render(() => ({
            all: useMarkets(),
            one: useMarket(name),
          }));
          await waitFor(() => expect(result.current.all).toEqual(list));
          expect(result.current.one).toEqual(expected);
          unmount();
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("useBook", () => {
  it("loads every market's book and returns the one asked for", async () => {
    routes["/markets"] = [market("BTC"), market("ETH")];
    routes["/book/BTC?levels=20"] = { best_bid: "1", best_ask: "3" };
    routes["/book/ETH?levels=20"] = { best_bid: "5", best_ask: "6" };
    const { result } = render(() => ({
      eth: useBook("ETH"),
      sol: useBook("SOL"),
    }));
    expect(result.current.eth).toBe(null);
    await waitFor(() =>
      expect(result.current.eth).toEqual({ best_bid: "5", best_ask: "6" }),
    );
    expect(result.current.sol).toBe(null);
  });
});

describe("useTrades", () => {
  it("returns recent prints, newest first as the server sends them", async () => {
    routes["/trades/BTC?limit=500"] = [
      stored(2, 5, "101"),
      stored(1, 4, "100"),
    ];
    const { result } = render(() => useTrades("BTC"));
    expect(result.current).toEqual([]);
    await waitFor(() =>
      expect(result.current).toEqual([
        {
          seq: 2,
          height: 5,
          timestamp_ms: 5000,
          market: "BTC",
          side: "buy",
          price: "101",
          size: "1000000",
        },
        {
          seq: 1,
          height: 4,
          timestamp_ms: 4000,
          market: "BTC",
          side: "buy",
          price: "100",
          size: "1000000",
        },
      ]),
    );
  });

  it("passes prints through a selector, leaving undefined before they load", async () => {
    routes["/trades/BTC?limit=500"] = [
      stored(2, 5, "101"),
      stored(1, 4, "100"),
    ];
    const { result } = render(() => useTrades("BTC", (t) => t[0].seq));
    expect(result.current).toBe(undefined);
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("asks nothing when no market is selected", async () => {
    const { result } = render(() => useTrades(""));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("useSeries", () => {
  it("combines candles with trade ticks", async () => {
    routes["/candles/BTC?interval=5m"] = [
      {
        ts: 60_000,
        open: "1000000",
        high: "3000000",
        low: "500000",
        close: "2000000",
      },
    ];
    routes["/trades/BTC?limit=500"] = [
      stored(2, 9, "2500000"),
      stored(1, 8, "2000000"),
    ];
    const { result } = render(() => useSeries("BTC", "5m", true));
    expect(result.current).toEqual({});
    await waitFor(() =>
      expect(result.current).toEqual({
        bars: [{ time: 60, open: 1, high: 3, low: 0.5, close: 2 }],
        ticks: [
          { time: 8, value: 2 },
          { time: 9, value: 2.5 },
        ],
      }),
    );
  });

  it("keeps the same series object across renders when nothing changed", async () => {
    const { result, rerender } = render(() => useSeries("", "1m", true));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first).toEqual({});
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual([]);
  });
});

describe("useSeries without ticks", () => {
  it("keeps trades loaded but never re-renders for them", async () => {
    routes["/candles/BTC?interval=1m"] = [];
    routes["/trades/BTC?limit=500"] = [stored(1, 8, "2000000")];
    let renders = 0;
    const { result } = render(() => {
      renders++;
      return useSeries("BTC", "1m", false);
    });
    await waitFor(() => expect(result.current).toEqual({ bars: [] }));
    await waitFor(() => expect(asked).toContain("/trades/BTC?limit=500"));
    const settled = renders;
    await new Promise((r) => setTimeout(r, 20));
    expect(renders).toBe(settled);
    expect(result.current).toEqual({ bars: [] });
  });
});

describe("useFunding", () => {
  it("returns funding rows for the market, empty before they arrive", async () => {
    const row = { height: 3, market: "BTC", index: "10", rate: "1", ts: 9 };
    routes["/funding/BTC?limit=50"] = [row];
    const { result } = render(() => useFunding("BTC"));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual([row]));
  });

  it("asks nothing without a market", async () => {
    const { result } = render(() => useFunding(""));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("stream-fed values", () => {
  it("start empty without asking the server", async () => {
    const { result } = render(() => ({
      feed: useFeed(),
      last: useLastBlockAt(),
      inclusion: useInclusionMs(),
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual({ feed: [], last: null, inclusion: null });
    expect(asked).toEqual([]);
  });
});

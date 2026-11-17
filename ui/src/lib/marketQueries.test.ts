import { QueryClient } from "@tanstack/react-query";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  booksQuery,
  candlesQuery,
  feedQuery,
  fundingQuery,
  marketsQuery,
  statusQuery,
  tradesQuery,
} from "./marketQueries";
import type { BlockMsg, MarketInfo, StoredTrade } from "../types";

function serve(respond: (url: string) => Response): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
    urls.push(url);
    return respond(url);
  });
  return urls;
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const market = (name: string): MarketInfo => ({
  name,
  tick_size: 1,
  lot_size: 1,
  max_leverage: 10,
  maintenance_margin_bps: 50,
  oracle_price: null,
  mark_price: null,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
});

const trade = (id: number): StoredTrade => ({
  id,
  height: 1000 + Math.floor(id / 3),
  tx_index: id % 3,
  market: "BTC",
  price: 50_000_000_000 + id,
  size: 1_000_000,
  taker: "ab",
  maker: "cd",
  side: id % 2 ? "sell" : "buy",
  liquidation: false,
  ts: 1_700_000_000_000 + id,
});

function tradeServer(total: number) {
  const all = Array.from({ length: total }, (_, i) => trade(total - i));
  return (url: string): Response => {
    const query = new URL(url, "http://x").searchParams;
    const limit = Number(query.get("limit"));
    const before = query.get("before_id");
    const from = before == null ? 0 : total - Number(before) + 1;
    return Response.json(all.slice(from, from + limit));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("feedQuery", () => {
  it("starts empty and resets to empty on refetch", async () => {
    const qc = client();
    await qc.prefetchQuery(feedQuery);
    expect(qc.getQueryData(feedQuery.queryKey)).toEqual([]);

    qc.setQueryData(feedQuery.queryKey, [{ height: 3 } as BlockMsg]);
    await qc.refetchQueries({ queryKey: ["stream", "feed"] });

    expect(qc.getQueryData(feedQuery.queryKey)).toEqual([]);
  });
});

describe("statusQuery", () => {
  it("adds the rounded round-trip time to the node status", async () => {
    const urls = serve(() => Response.json({ height: 42, mempool: 3 }));
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(112.6);
    const qc = client();

    await qc.fetchQuery(statusQuery);

    expect(urls).toEqual(["/status"]);
    expect(qc.getQueryData(["market", "status"])).toEqual({
      height: 42,
      mempool: 3,
      rttMs: 13,
    });
  });

  it("fails with the URL and status", async () => {
    serve(() => new Response("", { status: 502 }));
    await expect(client().fetchQuery(statusQuery)).rejects.toThrow(
      "/status answered 502",
    );
  });
});

describe("marketsQuery", () => {
  it("caches the market list", async () => {
    const urls = serve(() => Response.json([market("BTC")]));
    const qc = client();

    await qc.fetchQuery(marketsQuery);

    expect(urls).toEqual(["/markets"]);
    expect(qc.getQueryData(["market", "list"])).toEqual([market("BTC")]);
  });
});

describe("booksQuery", () => {
  it("fetches the market list first, then a book per market", async () => {
    const urls = serve((url) =>
      url === "/markets"
        ? Response.json([market("BTC"), market("ETH/USD")])
        : Response.json({ best_bid: url.length }),
    );
    const qc = client();

    await qc.fetchQuery(booksQuery);

    expect(urls).toEqual([
      "/markets",
      "/book/BTC?levels=20",
      "/book/ETH%2FUSD?levels=20",
    ]);
    expect(qc.getQueryData(["market", "books"])).toEqual({
      BTC: { best_bid: 19 },
      "ETH/USD": { best_bid: 25 },
    });
    expect(qc.getQueryData(["market", "list"])).toEqual([
      market("BTC"),
      market("ETH/USD"),
    ]);
  });

  it("reuses a cached market list", async () => {
    const urls = serve(() => Response.json({ best_ask: 7 }));
    const qc = client();
    qc.setQueryData(marketsQuery.queryKey, [market("SOL")]);

    expect(await qc.fetchQuery(booksQuery)).toEqual({ SOL: { best_ask: 7 } });
    expect(urls).toEqual(["/book/SOL?levels=20"]);
  });

  it("keys each book by the market name its URL was built from", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.string().filter((name) => name !== "__proto__"),
          { maxLength: 6 },
        ),
        async (names) => {
          serve((url) => {
            const match = /^\/book\/([^/?#]*)\?levels=20$/.exec(url);
            if (!match) return new Response("", { status: 400 });
            return Response.json({ name: decodeURIComponent(match[1]) });
          });
          const qc = client();
          qc.setQueryData(marketsQuery.queryKey, names.map(market));

          const books = await qc.fetchQuery(booksQuery);

          expect(Object.keys(books).sort()).toEqual([...names].sort());
          for (const name of names) expect(books[name]).toEqual({ name });
        },
      ),
    );
  });
});

describe("tradesQuery", () => {
  it("returns a short first page as prints", async () => {
    const urls = serve(() => Response.json([trade(5)]));
    const qc = client();

    await qc.fetchQuery(tradesQuery("BTC/USD"));

    expect(urls).toEqual(["/trades/BTC%2FUSD?limit=500"]);
    expect(qc.getQueryData(["market", "trades", "BTC/USD"])).toEqual([
      {
        seq: 5,
        height: 1001,
        timestamp_ms: 1_700_000_000_005,
        market: "BTC",
        side: "sell",
        price: 50_000_000_005,
        size: 1_000_000,
      },
    ]);
  });

  it("pages backwards from the last row of each full page", async () => {
    const urls = serve(tradeServer(1200));

    const prints = await client().fetchQuery(tradesQuery("BTC"));

    expect(urls).toEqual([
      "/trades/BTC?limit=500",
      "/trades/BTC?limit=500&before_height=1233&before_tx=2&before_id=701",
      "/trades/BTC?limit=500&before_height=1067&before_tx=0&before_id=201",
    ]);
    expect(prints).toHaveLength(1200);
    expect(prints[0].seq).toBe(1200);
    expect(prints[1199].seq).toBe(1);
  });

  it("stops at two thousand trades", async () => {
    const urls = serve(tradeServer(5000));

    const prints = await client().fetchQuery(tradesQuery("BTC"));

    expect(urls).toHaveLength(4);
    expect(prints).toHaveLength(2000);
    expect(prints.at(-1)?.seq).toBe(3001);
  });

  it("returns the newest trades, newest first, without gaps or repeats", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2600 }), async (total) => {
        const urls = serve(tradeServer(total));

        const prints = await client().fetchQuery(tradesQuery("BTC"));

        const kept = Math.min(total, 2000);
        expect(prints.map((row) => row.seq)).toEqual(
          Array.from({ length: kept }, (_, i) => total - i),
        );
        expect(urls).toHaveLength(Math.min(Math.floor(total / 500) + 1, 4));
      }),
      { numRuns: 40 },
    );
  });

  it("fails with the URL and status", async () => {
    serve(() => new Response("", { status: 500 }));
    await expect(client().fetchQuery(tradesQuery("BTC"))).rejects.toThrow(
      "/trades/BTC?limit=500 answered 500",
    );
  });
});

describe("candlesQuery", () => {
  const candle = (ts: number, close: number) => ({
    ts,
    open: close,
    high: close,
    low: close,
    close,
  });

  it("loads the full series when nothing is cached", async () => {
    const urls = serve(() =>
      Response.json([candle(1_700_000_060_000, 2_000_000)]),
    );
    const qc = client();

    await qc.fetchQuery(candlesQuery("BTC/USD", "1m"));

    expect(urls).toEqual(["/candles/BTC%2FUSD?interval=1m"]);
    expect(qc.getQueryData(["market", "candles", "BTC/USD", "1m"])).toEqual({
      bars: [{ time: 1_700_000_060, open: 2, high: 2, low: 2, close: 2 }],
    });
  });

  it("refetches from one interval before the last bar and merges", async () => {
    const qc = client();
    const key = candlesQuery("BTC", "5m").queryKey;
    qc.setQueryData(key, {
      ticks: [{ time: 9, value: 1 }],
      bars: [
        { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
        { time: 1_700_000_300, open: 2, high: 2, low: 2, close: 2 },
      ],
    });
    const urls = serve(() =>
      Response.json([
        candle(1_700_000_300_000, 3_000_000),
        candle(1_700_000_600_000, 4_000_000),
      ]),
    );

    await qc.fetchQuery({ ...candlesQuery("BTC", "5m"), staleTime: 0 });

    expect(urls).toEqual(["/candles/BTC?interval=5m&start=1700000000000"]);
    expect(qc.getQueryData(key)).toEqual({
      ticks: [{ time: 9, value: 1 }],
      bars: [
        { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
        { time: 1_700_000_300, open: 3, high: 3, low: 3, close: 3 },
        { time: 1_700_000_600, open: 4, high: 4, low: 4, close: 4 },
      ],
    });
  });

  it("refetches the whole range when cached bars are empty", async () => {
    const qc = client();
    qc.setQueryData(candlesQuery("BTC", "1m").queryKey, { bars: [] });
    const urls = serve(() => Response.json([]));

    await qc.fetchQuery({ ...candlesQuery("BTC", "1m"), staleTime: 0 });

    expect(urls).toEqual(["/candles/BTC?interval=1m"]);
  });

  it("keeps bars strictly increasing across any sequence of refreshes", async () => {
    const refresh = fc.array(
      fc.record({
        minute: fc.integer({ min: 0, max: 30 }),
        close: fc.integer({ min: 1, max: 9 }),
      }),
      { maxLength: 6 },
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(refresh, { minLength: 1, maxLength: 5 }),
        async (refreshes) => {
          const qc = client();
          const query = { ...candlesQuery("BTC", "1m"), staleTime: 0 };
          for (const rows of refreshes) {
            serve(() =>
              Response.json(
                rows.map((row) =>
                  candle(1_700_000_000_000 + row.minute * 60_000, row.close),
                ),
              ),
            );
            await qc.fetchQuery(query);
          }
          const bars = qc.getQueryData(query.queryKey)?.bars ?? [];
          for (let i = 1; i < bars.length; i++) {
            expect(bars[i].time).toBeGreaterThan(bars[i - 1].time);
          }
          const last = refreshes.at(-1)!;
          for (const row of last) {
            const time = 1_700_000_000 + row.minute * 60;
            const sameMinute = last.filter((r) => r.minute === row.minute);
            expect(bars.find((bar) => bar.time === time)?.close).toBe(
              sameMinute.at(-1)!.close / 1e6,
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("fundingQuery", () => {
  it("caches the last fifty funding rows", async () => {
    const rows = [
      { height: 5, market: "ETH", index: 10, rate: -2, ts: 1_700_000_000_000 },
    ];
    const urls = serve(() => Response.json(rows));
    const qc = client();

    await qc.fetchQuery(fundingQuery("ETH"));

    expect(urls).toEqual(["/funding/ETH?limit=50"]);
    expect(qc.getQueryData(["market", "funding", "ETH"])).toEqual(rows);
  });
});

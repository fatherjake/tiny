import { queryOptions } from "@tanstack/react-query";

import { readJson } from "./api";
import { foldTrades, toBars } from "./series";
import type {
  BlockMsg,
  Depth,
  FundingRow,
  MarketInfo,
  Status,
  StoredCandle,
  StoredTrade,
  Trade,
} from "../types";

export const marketKeys = {
  all: ["market"] as const,
  status: ["market", "status"] as const,
  list: ["market", "list"] as const,
  books: ["market", "books"] as const,
  trades: (market: string) => ["market", "trades", market] as const,
  candles: (market: string, interval: Interval) =>
    ["market", "candles", market, interval] as const,
  funding: (market: string) => ["market", "funding", market] as const,
};

export const feedQuery = queryOptions({
  queryKey: ["stream", "feed"] as const,
  queryFn: (): BlockMsg[] => [],
  initialData: [] as BlockMsg[],
  staleTime: Infinity,
  gcTime: Infinity,
});

export const MAX_TRADES = 500;
export const INTERVAL_MS = {
  "1s": 1_000,
  "3s": 3_000,
  "15s": 15_000,
  "1m": 60_000,
  "5m": 300_000,
} as const;
export type Interval = keyof typeof INTERVAL_MS;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(url + " answered " + res.status);
  return readJson<T>(res);
}

function asPrint(row: StoredTrade): Trade {
  return {
    seq: row.id,
    height: row.height,
    timestamp_ms: row.ts,
    market: row.market,
    side: row.side,
    price: row.price,
    size: row.size,
  };
}

export const statusQuery = queryOptions({
  queryKey: marketKeys.status,
  queryFn: async ({ signal }) => {
    const start = performance.now();
    const status = await getJson<Status>("/status", signal);
    return { ...status, rttMs: Math.round(performance.now() - start) };
  },
  refetchInterval: 1_000,
});

export const marketsQuery = queryOptions({
  queryKey: marketKeys.list,
  queryFn: ({ signal }) => getJson<MarketInfo[]>("/markets", signal),
});

export const booksQuery = queryOptions({
  queryKey: marketKeys.books,
  queryFn: async ({ client, signal }) => {
    const markets = await client.query({
      ...marketsQuery,
      staleTime: "static",
    });
    const books = await Promise.all(
      markets.map(
        async (market) =>
          [
            market.name,
            await getJson<Depth>(
              "/book/" + encodeURIComponent(market.name) + "?levels=20",
              signal,
            ),
          ] as const,
      ),
    );
    return Object.fromEntries(books) as Record<string, Depth>;
  },
  staleTime: Infinity,
});

export const tradesQuery = (market: string) =>
  queryOptions({
    queryKey: marketKeys.trades(market),
    queryFn: async ({ signal }) => {
      const rows = await getJson<StoredTrade[]>(
        "/trades/" + encodeURIComponent(market) + "?limit=" + MAX_TRADES,
        signal,
      );
      return rows.map(asPrint);
    },
    staleTime: Infinity,
  });

export const candlesQuery = (market: string, interval: Interval) =>
  queryOptions({
    queryKey: marketKeys.candles(market, interval),
    queryFn: async ({ client, signal }) => {
      const rows = await getJson<StoredCandle[]>(
        "/candles/" + encodeURIComponent(market) + "?interval=" + interval,
        signal,
      );
      const trades =
        client.getQueryData<Trade[]>(marketKeys.trades(market)) ?? [];
      return foldTrades(
        toBars(rows),
        [...trades].reverse(),
        INTERVAL_MS[interval],
      );
    },
    staleTime: Infinity,
  });

export const fundingQuery = (market: string) =>
  queryOptions({
    queryKey: marketKeys.funding(market),
    queryFn: ({ signal }) =>
      getJson<FundingRow[]>(
        "/funding/" + encodeURIComponent(market) + "?limit=50",
        signal,
      ),
    refetchInterval: 1_000,
  });

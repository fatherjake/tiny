import { queryOptions } from "@tanstack/react-query";

import { readJson } from "./api";
import { applyCandles } from "./series";
import type {
  Depth,
  FundingRow,
  MarketInfo,
  Series,
  Status,
  StoredCandle,
  StoredTrade,
  Trade,
} from "../types";

// Every key starts with "market", so a resync can invalidate them all without
// touching wagmi's queries in the same client.
export const marketKeys = {
  all: ["market"] as const,
  status: ["market", "status"] as const,
  list: ["market", "list"] as const,
  books: ["market", "books"] as const,
  trades: (market: string) => ["market", "trades", market] as const,
  candles: (market: string) => ["market", "candles", market] as const,
  funding: (market: string) => ["market", "funding", market] as const,
};

export const TICK_TRADES = 2_000;
const PAGE = 500;

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
  queryFn: ({ signal }) => getJson<Status>("/status", signal),
  refetchInterval: 1_000,
});

export const marketsQuery = queryOptions({
  queryKey: marketKeys.list,
  queryFn: ({ signal }) => getJson<MarketInfo[]>("/markets", signal),
});

// One entry for every market's depth: closing a position reads the book of its
// market, not the selected one. Book frames keep it current.
export const booksQuery = queryOptions({
  queryKey: marketKeys.books,
  queryFn: async ({ client, signal }) => {
    const markets = await client.ensureQueryData(marketsQuery);
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

// Newest first. Trade frames prepend to it.
export const tradesQuery = (market: string) =>
  queryOptions({
    queryKey: marketKeys.trades(market),
    queryFn: async ({ signal }) => {
      const rows: StoredTrade[] = [];
      let cursor: StoredTrade | undefined;
      while (rows.length < TICK_TRADES) {
        const query = new URLSearchParams({ limit: String(PAGE) });
        if (cursor) {
          query.set("before_height", String(cursor.height));
          query.set("before_tx", String(cursor.tx_index));
          query.set("before_id", String(cursor.id));
        }
        const page = await getJson<StoredTrade[]>(
          "/trades/" + encodeURIComponent(market) + "?" + query,
          signal,
        );
        rows.push(...page);
        if (page.length < PAGE) break;
        cursor = page[page.length - 1];
      }
      return rows.map(asPrint);
    },
    staleTime: Infinity,
  });

// Each refetch asks only for the bars from the last cached minute on.
export const candlesQuery = (market: string) =>
  queryOptions({
    queryKey: marketKeys.candles(market),
    queryFn: async ({ client, queryKey, signal }) => {
      const prev = client.getQueryData<Series>(queryKey) ?? {};
      const last = prev.bars?.at(-1);
      const start = last == null ? "" : "&start=" + (last.time * 1000 - 60_000);
      const rows = await getJson<StoredCandle[]>(
        "/candles/" + encodeURIComponent(market) + "?interval=1m" + start,
        signal,
      );
      return applyCandles(prev, rows);
    },
    refetchInterval: 1_000,
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

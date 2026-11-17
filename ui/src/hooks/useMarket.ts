import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  booksQuery,
  candlesQuery,
  type Interval,
  feedQuery,
  fundingQuery,
  marketsQuery,
  statusQuery,
  tradesQuery,
} from "../lib/marketQueries";
import { inclusionQuery, lastBlockQuery } from "../lib/latency";
import { extendTicks } from "../lib/series";
import type { MarketInfo, Series, Trade } from "../types";

const NONE: never[] = [];

export function useStatus() {
  return useQuery(statusQuery).data ?? null;
}

export function useMarkets() {
  return useQuery(marketsQuery).data ?? NONE;
}

export function useMarketsSelect<T>(select: (markets: MarketInfo[]) => T) {
  return useQuery({ ...marketsQuery, select }).data;
}

export function useMarket(name: string) {
  return (
    useMarketsSelect((markets) => markets.find((m) => m.name === name)) ?? null
  );
}

export function useBook(market: string) {
  return (
    useQuery({ ...booksQuery, select: (books) => books[market] }).data ?? null
  );
}

export function useTrades(market: string): Trade[];
export function useTrades<T>(
  market: string,
  select: (trades: Trade[]) => T,
): T | undefined;
export function useTrades<T>(market: string, select?: (trades: Trade[]) => T) {
  const data = useQuery({
    ...tradesQuery(market),
    enabled: market !== "",
    select,
  }).data;
  return select ? data : (data ?? NONE);
}

export function useSeries(
  market: string,
  interval: Interval,
  ticks: boolean,
): Series {
  const on = market !== "";
  const candles = useQuery({
    ...candlesQuery(market, interval),
    enabled: on,
  }).data;
  const trades = useQuery({
    ...tradesQuery(market),
    enabled: on,
    notifyOnChangeProps: ticks ? ["data"] : [],
  }).data;
  const used = ticks ? trades : undefined;
  const [kept, setKept] = useState({
    market,
    rows: undefined as Trade[] | undefined,
    ticks: [] as NonNullable<Series["ticks"]>,
  });
  if (kept.market !== market || (used && kept.rows !== used)) {
    const prev = kept.market === market ? kept.ticks : [];
    setKept({
      market,
      rows: used,
      ticks: used ? extendTicks(prev, used) : prev,
    });
  }
  return useMemo(
    () =>
      kept.ticks.length
        ? { ...(candles ?? {}), ticks: kept.ticks }
        : (candles ?? {}),
    [candles, kept.ticks],
  );
}

export function useFunding(market: string) {
  return (
    useQuery({ ...fundingQuery(market), enabled: market !== "" }).data ?? NONE
  );
}

export function useFeed() {
  return useQuery(feedQuery).data;
}

export function useLastBlockAt() {
  return useQuery(lastBlockQuery).data;
}

export function useInclusionMs() {
  return useQuery(inclusionQuery).data;
}

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  booksQuery,
  candlesQuery,
  feedQuery,
  fundingQuery,
  marketsQuery,
  statusQuery,
  tradesQuery,
} from "../lib/marketQueries";
import { seed } from "../lib/series";
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

export function useSeries(market: string): Series {
  const on = market !== "";
  const candles = useQuery({ ...candlesQuery(market), enabled: on }).data;
  const trades = useQuery({ ...tradesQuery(market), enabled: on }).data;
  return useMemo(() => seed(candles ?? {}, trades ?? []), [candles, trades]);
}

export function useFunding(market: string) {
  return (
    useQuery({ ...fundingQuery(market), enabled: market !== "" }).data ?? NONE
  );
}

export function useFeed() {
  return useQuery(feedQuery).data;
}

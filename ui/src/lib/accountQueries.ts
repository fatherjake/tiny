import { queryOptions } from "@tanstack/react-query";

import { readJson } from "./api";
import type {
  AccountView,
  OpenOrder,
  StoredOrder,
  StoredTrade,
} from "../types";

export const accountKeys = {
  all: ["account"] as const,
  view: (trader: string) => ["account", trader, "view"] as const,
  open: (trader: string) => ["account", trader, "open"] as const,
  history: (trader: string) => ["account", trader, "history"] as const,
  fills: (trader: string) => ["account", trader, "fills"] as const,
};

const EVERY_MS = 1_000;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(url + " answered " + res.status);
  return readJson<T>(res);
}

const base = (trader: string) =>
  "/accounts/" + encodeURIComponent(trader) + "/";

function asOpen(row: StoredOrder): OpenOrder {
  return {
    id: row.order_id,
    market: row.market,
    side: row.side,
    price: row.price,
    size: row.remaining,
  };
}

export const accountQuery = (trader: string) =>
  queryOptions({
    queryKey: accountKeys.view(trader),
    queryFn: async ({ signal }) => {
      const res = await fetch("/account/" + encodeURIComponent(trader), {
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("/account answered " + res.status);
      return readJson<AccountView>(res);
    },
    refetchInterval: EVERY_MS,
  });

export const openOrdersQuery = (trader: string) =>
  queryOptions({
    queryKey: accountKeys.open(trader),
    queryFn: async ({ signal }) =>
      (
        await getJson<StoredOrder[]>(
          base(trader) + "orders?status=open",
          signal,
        )
      ).map(asOpen),
    refetchInterval: EVERY_MS,
  });

export const orderHistoryQuery = (trader: string) =>
  queryOptions({
    queryKey: accountKeys.history(trader),
    queryFn: ({ signal }) =>
      getJson<StoredOrder[]>(
        base(trader) + "orders?status=history&limit=50",
        signal,
      ),
    refetchInterval: EVERY_MS,
  });

export const fillsQuery = (trader: string) =>
  queryOptions({
    queryKey: accountKeys.fills(trader),
    queryFn: ({ signal }) =>
      getJson<StoredTrade[]>(base(trader) + "fills?limit=50", signal),
    refetchInterval: EVERY_MS,
  });

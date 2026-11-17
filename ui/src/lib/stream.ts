import type { QueryClient } from "@tanstack/react-query";

import { accountKeys } from "./accountQueries";
import { inclusionMs, inclusionQuery, lastBlockQuery } from "./latency";
import {
  feedQuery,
  INTERVAL_MS,
  type Interval,
  marketKeys,
  MAX_TRADES,
} from "./marketQueries";
import { foldTrades } from "./series";
import type {
  BlockMsg,
  Candle,
  Depth,
  Status,
  Trade,
  WsMessage,
} from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;

export type FrameState = { lastAccount: number };

export function applyFrame(
  client: QueryClient,
  msg: WsMessage,
  state: FrameState,
): void {
  if (msg.type === "block") {
    client.setQueryData(lastBlockQuery.queryKey, Date.now());
    const included = inclusionMs(msg.txs ?? []);
    if (included != null) {
      client.setQueryData(inclusionQuery.queryKey, included);
    }
    if (Date.now() - state.lastAccount >= REFRESH_MS) {
      state.lastAccount = Date.now();
      void client.invalidateQueries({ queryKey: accountKeys.all });
    }
    client.setQueryData<BlockMsg[]>(feedQuery.queryKey, (rows = []) =>
      [msg, ...rows].slice(0, FEED_LIMIT),
    );
    client.setQueryData<Status>(marketKeys.status, (prev) => ({
      ...prev,
      height: msg.height,
      view: msg.view,
      tip: msg.hash,
    }));
    void client.invalidateQueries({ queryKey: marketKeys.list });
  } else if (msg.type === "book") {
    client.setQueryData<Record<string, Depth>>(marketKeys.books, (prev) => ({
      ...prev,
      [msg.market]: msg,
    }));
  } else {
    const { type: _type, ...trade } = msg;
    queueTrade(client, trade);
  }
}

type Batch = { trades: Map<string, Trade[]>; frame: number | null };

const batches = new WeakMap<QueryClient, Batch>();

function queueTrade(client: QueryClient, trade: Trade): void {
  let batch = batches.get(client);
  if (!batch) {
    batch = { trades: new Map(), frame: null };
    batches.set(client, batch);
  }
  const list = batch.trades.get(trade.market) ?? [];
  list.push(trade);
  if (list.length > MAX_TRADES * 2) list.splice(0, list.length - MAX_TRADES);
  batch.trades.set(trade.market, list);
  batch.frame ??= requestAnimationFrame(() => flushTrades(client));
}

export function flushTrades(client: QueryClient): void {
  const batch = batches.get(client);
  if (!batch) return;
  if (batch.frame != null) cancelAnimationFrame(batch.frame);
  batch.frame = null;
  for (const [market, list] of batch.trades) {
    client.setQueryData<Trade[]>(marketKeys.trades(market), (prev) =>
      mergeTrades(prev, list),
    );
    for (const [key, bars] of client.getQueriesData<Candle[]>({
      queryKey: ["market", "candles", market],
    })) {
      if (!bars) continue;
      const interval = key[3] as Interval;
      client.setQueryData(key, foldTrades(bars, list, INTERVAL_MS[interval]));
    }
  }
  batch.trades.clear();
}

export function mergeTrades(
  prev: Trade[] | undefined,
  incoming: Trade[],
): Trade[] | undefined {
  if (prev == null) return prev;
  const seen = new Set(prev.map((row) => row.seq));
  const fresh: Trade[] = [];
  for (let i = incoming.length - 1; i >= 0; i--) {
    const trade = incoming[i];
    if (seen.has(trade.seq)) continue;
    seen.add(trade.seq);
    fresh.push(trade);
  }
  return fresh.length ? [...fresh, ...prev].slice(0, MAX_TRADES) : prev;
}

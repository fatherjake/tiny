import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useWebSocket } from "./useWebSocket";
import { accountKeys } from "../lib/accountQueries";
import { advance, START } from "../lib/gaps";
import { inclusionMs, inclusionQuery, lastBlockQuery } from "../lib/latency";
import { feedQuery, marketKeys, TICK_TRADES } from "../lib/marketQueries";
import type { BlockMsg, Depth, Status, Trade } from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;

export function useMarketStream() {
  const client = useQueryClient();
  const lastAccount = useRef(0);
  const cursor = useRef(START);

  const ws = useWebSocket("/ws", (msg) => {
    const next = advance(cursor.current, msg);
    if (next.gap) {
      console.warn("ws: missed frames, resyncing", {
        from: cursor.current,
        at: msg,
      });
      void client.invalidateQueries({ queryKey: marketKeys.all });
      void client.invalidateQueries({ queryKey: accountKeys.all });
    }
    cursor.current = next.cursor;
    if (msg.type === "block") {
      client.setQueryData(lastBlockQuery.queryKey, Date.now());
      const included = inclusionMs(msg.txs ?? []);
      if (included != null) {
        client.setQueryData(inclusionQuery.queryKey, included);
      }
      if (Date.now() - lastAccount.current >= REFRESH_MS) {
        lastAccount.current = Date.now();
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
      client.setQueryData<Trade[]>(marketKeys.trades(trade.market), (prev) =>
        prev == null || prev.some((row) => row.seq === trade.seq)
          ? prev
          : [trade, ...prev].slice(0, TICK_TRADES),
      );
    }
  });

  return ws;
}

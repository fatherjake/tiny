import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useWebSocket } from "./useWebSocket";
import { accountKeys } from "../lib/accountQueries";
import { advance, START } from "../lib/gaps";
import { feedQuery, marketKeys, TICK_TRADES } from "../lib/marketQueries";
import type { BlockMsg, Depth, Status, Trade } from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;

// Call once, at the root. Writes socket frames into the query cache and
// returns only the connection status, so the root does not re-render per frame.
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
      // A block can change fills, orders and margin. Blocks come faster than
      // the account needs, so refetch it at most once per REFRESH_MS.
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
      // Before the first load there is nothing to prepend to, and the load
      // itself returns this trade.
      client.setQueryData<Trade[]>(marketKeys.trades(trade.market), (prev) =>
        prev == null || prev.some((row) => row.seq === trade.seq)
          ? prev
          : [trade, ...prev].slice(0, TICK_TRADES),
      );
    }
  });

  return ws;
}

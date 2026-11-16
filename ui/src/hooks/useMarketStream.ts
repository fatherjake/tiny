import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useWebSocket } from "./useWebSocket";
import { advance, START } from "../lib/gaps";
import { feedQuery, marketKeys, TICK_TRADES } from "../lib/marketQueries";
import type { BlockMsg, Depth, Status, Trade } from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;

// Call once, at the root. Writes socket frames into the query cache and
// returns only what changes rarely, so the root does not re-render per frame.
export function useMarketStream() {
  const client = useQueryClient();
  const [landed, setLanded] = useState(0);
  const lastLanded = useRef(0);
  const cursor = useRef(START);

  const ws = useWebSocket("/ws", (msg) => {
    const next = advance(cursor.current, msg);
    if (next.gap) {
      console.warn("ws: missed frames, resyncing", {
        from: cursor.current,
        at: msg,
      });
      void client.invalidateQueries({ queryKey: marketKeys.all });
    }
    cursor.current = next.cursor;
    if (msg.type === "block") {
      if (Date.now() - lastLanded.current >= REFRESH_MS) {
        lastLanded.current = Date.now();
        setLanded((value) => value + 1);
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

  return { ws, landed };
}

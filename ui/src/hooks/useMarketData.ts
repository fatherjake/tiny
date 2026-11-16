import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useWebSocket } from "./useWebSocket";
import { advance, START } from "../lib/gaps";
import {
  booksQuery,
  candlesQuery,
  fundingQuery,
  marketKeys,
  marketsQuery,
  statusQuery,
  TICK_TRADES,
  tradesQuery,
} from "../lib/marketQueries";
import { seed } from "../lib/series";
import type { BlockMsg, Depth, Status, Trade } from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;
const PRINTS = 40;
const NO_BOOKS: Record<string, Depth> = {};
const NONE: never[] = [];

export function useMarketData() {
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [feed, setFeed] = useState<BlockMsg[]>([]);
  const [landed, setLanded] = useState(0);
  const lastLanded = useRef(0);
  const cursor = useRef(START);

  const status = useQuery(statusQuery).data ?? null;
  const markets = useQuery(marketsQuery).data;
  const books = useQuery(booksQuery).data ?? NO_BOOKS;
  const on = { enabled: selected !== "" };
  const trades = useQuery({ ...tradesQuery(selected), ...on }).data;
  const candles = useQuery({ ...candlesQuery(selected), ...on }).data;
  const funding = useQuery({ ...fundingQuery(selected), ...on }).data ?? NONE;

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
      setFeed((rows) => [msg, ...rows].slice(0, FEED_LIMIT));
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

  useEffect(() => {
    if (!selected && markets?.length) setSelected(markets[0].name);
  }, [markets, selected]);

  const series = useMemo(
    () => seed(candles ?? {}, trades ?? []),
    [candles, trades],
  );
  const prints = useMemo(() => (trades ?? []).slice(0, PRINTS), [trades]);

  return {
    status,
    markets: markets ?? NONE,
    books,
    series,
    selected,
    setSelected,
    feed,
    prints,
    funding,
    landed,
    ws,
  };
}

import { useEffect, useRef, useState } from "react";

import { useWebSocket } from "./useWebSocket";
import { readJson } from "../lib/api";
import { applyCandles, rememberPrint, seed } from "../lib/series";
import type { BlockMsg, Depth, FundingRow, MarketInfo, Series, Status, StoredCandle, StoredTrade, Trade } from "../types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;
const TICK_TRADES = 2_000;

function asPrint(row: StoredTrade): Trade {
  return { seq: row.id, height: row.height, timestamp_ms: row.ts, market: row.market, side: row.side, price: row.price, size: row.size };
}

async function recentTrades(market: string): Promise<StoredTrade[] | null> {
  const rows: StoredTrade[] = [];
  let cursor: StoredTrade | null = null;
  while (rows.length < TICK_TRADES) {
    const query = new URLSearchParams({ limit: "500" });
    if (cursor) {
      query.set("before_height", String(cursor.height));
      query.set("before_tx", String(cursor.tx_index));
      query.set("before_id", String(cursor.id));
    }
    const res = await fetch("/trades/" + market + "?" + query);
    if (!res.ok) return rows.length ? rows : null;
    const page = await readJson<StoredTrade[]>(res);
    rows.push(...page);
    if (page.length < 500) return rows;
    cursor = page[page.length - 1];
  }
  return rows;
}

export function useMarketData() {
  const [status, setStatus] = useState<Status | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [books, setBooks] = useState<Record<string, Depth>>({});
  const [series, setSeries] = useState<Record<string, Series>>({});
  const [selected, setSelected] = useState("");
  const [feed, setFeed] = useState<BlockMsg[]>([]);
  const [prints, setPrints] = useState<Trade[]>([]);
  const [funding, setFunding] = useState<FundingRow[]>([]);
  const [landed, setLanded] = useState(0);
  const lastLanded = useRef(0);
  const ws = useWebSocket("/ws", (msg) => {
    if (msg.type === "block") {
      if (Date.now() - lastLanded.current >= REFRESH_MS) {
        lastLanded.current = Date.now();
        setLanded((value) => value + 1);
      }
      setFeed((rows) => [msg, ...rows].slice(0, FEED_LIMIT));
      setStatus((prev) => ({ ...(prev ?? {}), height: msg.height, view: msg.view, tip: msg.hash }));
      fetch("/markets").then(async (res) => res.ok && setMarkets(await readJson<MarketInfo[]>(res))).catch(() => {});
    } else if (msg.type === "book") setBooks((prev) => ({ ...prev, [msg.market]: msg }));
    else {
      setPrints((rows) => (rows.some((row) => row.seq === msg.seq) ? rows : [msg, ...rows].slice(0, 40)));
      setSeries((prev) => rememberPrint(prev, msg.market, msg));
    }
  });
  useEffect(() => {
    const tick = () => fetch("/status").then(async (res) => res.ok && setStatus(await readJson<Status>(res))).catch(() => {});
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    fetch("/markets").then(async (res) => res.ok && setMarkets(await readJson<MarketInfo[]>(res))).catch(() => {});
  }, []);
  useEffect(() => { if (!selected && markets.length) setSelected(markets[0].name); }, [markets, selected]);
  useEffect(() => {
    if (!selected) return;
    let stop = false;
    let since: number | null = null;
    const load = async (first: boolean) => {
      const market = encodeURIComponent(selected);
      const [candles, trades, fund] = await Promise.all([
        fetch("/candles/" + market + "?interval=1m" + (since == null ? "" : "&start=" + since)),
        first ? recentTrades(market) : fetch("/trades/" + market + "?limit=200").then((res) => res.ok ? readJson<StoredTrade[]>(res) : null),
        fetch("/funding/" + market + "?limit=50"),
      ]);
      if (stop) return;
      if (candles.ok) {
        const rows = await readJson<StoredCandle[]>(candles);
        if (rows.length) since = Number(rows[rows.length - 1].ts) - 60_000;
        setSeries((prev) => ({ ...prev, [selected]: applyCandles(prev[selected] || {}, rows) }));
      }
      if (trades) {
        setPrints(trades.slice(0, 40).map(asPrint));
        setSeries((prev) => ({ ...prev, [selected]: seed(prev[selected] || {}, trades.map((row) => ({ height: row.height, price: row.price }))) }));
      }
      if (fund.ok) setFunding(await readJson<FundingRow[]>(fund));
    };
    void load(true).then(async () => {
      const res = await fetch("/book/" + encodeURIComponent(selected) + "?levels=20");
      if (!stop && res.ok) {
        const next = await readJson<Depth>(res);
        setBooks((prev) => ({ ...prev, [selected]: next }));
      }
    });
    const id = window.setInterval(() => void load(false), 1000);
    return () => { stop = true; clearInterval(id); };
  }, [selected]);
  return { status, markets, books, series, selected, setSelected, feed, prints, funding, landed, ws };
}

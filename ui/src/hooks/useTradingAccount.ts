import { useCallback, useEffect, useState } from "react";

import { readJson } from "../lib/api";
import type { AccountView, OpenOrder, StoredOrder, StoredTrade } from "../types";
import type { TraderKey } from "./useTraderSession";

function asOpen(row: StoredOrder): OpenOrder {
  return { id: row.order_id, market: row.market, side: row.side, price: row.price, size: row.remaining };
}

export function useTradingAccount(key: TraderKey | null, landed: number) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [history, setHistory] = useState<StoredOrder[]>([]);
  const [fills, setFills] = useState<StoredTrade[]>([]);
  const refreshAccount = useCallback(async () => {
    if (!key) return null;
    const res = await fetch("/account/" + key.trader);
    if (res.status === 404) {
      setAccount(null);
      return null;
    }
    if (!res.ok) return null;
    const next = await readJson<AccountView>(res);
    setAccount(next);
    return next;
  }, [key]);

  useEffect(() => {
    if (!key) {
      setAccount(null);
      setOrders([]);
      setHistory([]);
      setFills([]);
      return;
    }
    let stop = false;
    const tick = async () => {
      try {
        const [next, open, past, trades] = await Promise.all([
          refreshAccount(),
          fetch("/accounts/" + encodeURIComponent(key.trader) + "/orders?status=open"),
          fetch("/accounts/" + encodeURIComponent(key.trader) + "/orders?status=history&limit=50"),
          fetch("/accounts/" + encodeURIComponent(key.trader) + "/fills?limit=50"),
        ]);
        if (stop || next === undefined) return;
        if (open.ok) setOrders((await readJson<StoredOrder[]>(open)).map(asOpen));
        if (past.ok) setHistory(await readJson<StoredOrder[]>(past));
        if (trades.ok) setFills(await readJson<StoredTrade[]>(trades));
      } catch {
        /* Keep the last successful account view. */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [key, landed, refreshAccount]);

  return { account, orders, history, fills, refreshAccount };
}

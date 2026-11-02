import { useEffect, useRef, useState } from "react";

import { Chart } from "./components/Chart";
import { Dock, type DockTab } from "./components/Dock";
import { Header } from "./components/Header";
import { KeyBox } from "./components/KeyBox";
import { Ladder } from "./components/Ladder";
import { OpenOrders } from "./components/OpenOrders";
import { OrderForm } from "./components/OrderForm";
import { useWebSocket } from "./hooks/useWebSocket";
import { TxError, generateKey, publicHex, readJson, secretFromHex, signAndPost } from "./lib/api";
import { gridNote, marketPrice } from "./lib/orders";
import { fmt, tryScaled, unscale } from "./lib/scale";
import { applyCandles, remember, rememberPrint, seed } from "./lib/series";
import type {
  AccountView,
  BlockMsg,
  Depth,
  FundingRow,
  MarketInfo,
  OpenOrder,
  OrderDraft,
  Series,
  Status,
  StoredCandle,
  StoredOrder,
  StoredTrade,
  Trade,
} from "./types";

const FEED_LIMIT = 50;

type TraderKey = { secret: Uint8Array; trader: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message || String(err) : String(err);
}

function asPrint(row: StoredTrade): Trade {
  return {
    seq: row.id,
    height: row.height,
    timestamp_ms: row.ts,
    market: row.market,
    side: row.side,
    price: row.price,
    size: row.size,
  };
}

function asOpen(row: StoredOrder): OpenOrder {
  return {
    id: row.order_id,
    market: row.market,
    side: row.side,
    price: row.price,
    size: row.remaining,
  };
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [books, setBooks] = useState<Record<string, Depth>>({});
  const [series, setSeries] = useState<Record<string, Series>>({});
  const [selected, setSelected] = useState("");
  const [feed, setFeed] = useState<BlockMsg[]>([]);
  const [prints, setPrints] = useState<Trade[]>([]);
  const [tab, setTab] = useState<DockTab>("positions");
  const [hex, setHex] = useState("");
  const [key, setKey] = useState<TraderKey | null>(null);
  const [keyError, setKeyError] = useState("");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [history, setHistory] = useState<StoredOrder[]>([]);
  const [fills, setFills] = useState<StoredTrade[]>([]);
  const [funding, setFunding] = useState<FundingRow[]>([]);
  const [form, setForm] = useState<OrderDraft>({
    side: "buy",
    type: "limit",
    size: "1",
    price: "100",
    reduceOnly: false,
  });
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [pending, setPending] = useState(false);
  const localNonce = useRef(0);
  const nextId = useRef(1);
  const busy = useRef(false);
  const keyToken = useRef(0);
  const [, bumpNonce] = useState(0);

  const ws = useWebSocket("/ws", (msg) => {
    if (msg.type === "block") {
      setFeed((xs) => [msg, ...xs].slice(0, FEED_LIMIT));
      setStatus((prev) => ({ ...(prev ?? {}), height: msg.height, view: msg.view, tip: msg.hash }));
      fetch("/markets")
        .then(async (res) => {
          if (res.ok) setMarkets(await readJson<MarketInfo[]>(res));
        })
        .catch(() => {});
    } else if (msg.type === "book") {
      setBooks((prev) => ({ ...prev, [msg.market]: msg }));
      setSeries((prev) => remember(prev, msg.market, msg));
    } else if (msg.type === "trade") {
      setPrints((xs) => (xs.some((print) => print.seq === msg.seq) ? xs : [msg, ...xs].slice(0, 40)));
      setSeries((prev) => rememberPrint(prev, msg.market, msg));
    } else {
      const unreachable: never = msg;
      return unreachable;
    }
  });

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch("/status");
        if (!stop && res.ok) setStatus(await readJson<Status>(res));
      } catch {
        /* keep the last status */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    fetch("/markets")
      .then(async (res) => {
        if (!stop && res.ok) setMarkets(await readJson<MarketInfo[]>(res));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!selected && markets.length) setSelected(markets[0].name);
  }, [markets, selected]);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    const load = async (limit: number) => {
      const market = encodeURIComponent(selected);
      const [tradeRes, candleRes, fundRes] = await Promise.all([
        fetch("/trades/" + market + "?limit=" + limit),
        fetch("/candles/" + market + "?interval=1m"),
        fetch("/funding/" + market + "?limit=50"),
      ]);
      if (stop) return;
      const rows = tradeRes.ok ? await readJson<StoredTrade[]>(tradeRes) : null;
      const bars = candleRes.ok ? await readJson<StoredCandle[]>(candleRes) : null;
      if (rows) setPrints(rows.slice(0, 40).map(asPrint));
      if (rows || bars) {
        setSeries((prev) => {
          const current = bars ? applyCandles(prev[selected] || {}, bars) : prev[selected] || {};
          const seeded = rows
            ? seed(
                current,
                rows.map((row) => ({ timestamp_ms: row.ts, price: row.price })),
              )
            : current;
          return { ...prev, [selected]: seeded };
        });
      }
      if (fundRes.ok) setFunding(await readJson<FundingRow[]>(fundRes));
    };
    let id = 0;
    load(20000)
      .then(async () => {
        if (stop) return;
        const res = await fetch("/book/" + encodeURIComponent(selected) + "?levels=20");
        if (stop || !res.ok) return;
        const book = await readJson<Depth>(res);
        setBooks((prev) => ({ ...prev, [selected]: book }));
        setSeries((prev) => remember(prev, selected, book));
        if (!stop) {
          id = window.setInterval(() => {
            load(200).catch(() => {});
          }, 1000);
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [selected]);

  useEffect(() => {
    if (!key) {
      setAccount(null);
      return;
    }
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch("/account/" + key.trader);
        if (stop) return;
        if (res.status === 404) {
          setAccount(null);
          return;
        }
        if (res.ok) setAccount(await readJson<AccountView>(res));
      } catch {
        /* keep the last account */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [key]);

  useEffect(() => {
    localNonce.current = 0;
    setOpenOrders([]);
    setHistory([]);
    setFills([]);
    setAccount(null);
    setNote("");
    setBad(false);
    bumpNonce((n) => n + 1);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let stop = false;
    const tick = async () => {
      const trader = encodeURIComponent(key.trader);
      try {
        const [openRes, histRes, fillRes] = await Promise.all([
          fetch("/accounts/" + trader + "/orders?status=open"),
          fetch("/accounts/" + trader + "/orders?status=history&limit=50"),
          fetch("/accounts/" + trader + "/fills?limit=50"),
        ]);
        if (stop) return;
        if (openRes.ok) setOpenOrders((await readJson<StoredOrder[]>(openRes)).map(asOpen));
        if (histRes.ok) setHistory(await readJson<StoredOrder[]>(histRes));
        if (fillRes.ok) setFills(await readJson<StoredTrade[]>(fillRes));
      } catch {
        /* keep the last rows */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [key]);

  const patch = (part: Partial<OrderDraft>) => setForm((prev) => ({ ...prev, ...part }));
  const nonce = Math.max(localNonce.current, account?.nonce ?? 0) + 1;
  const market = markets.find((item) => item.name === selected) ?? null;
  const book = books[selected] ?? null;
  const orders = openOrders;

  async function resyncNonce() {
    if (!key) return;
    const res = await fetch("/account/" + key.trader);
    if (res.status === 404) {
      setAccount(null);
      return;
    }
    if (res.ok) {
      const body = await readJson<AccountView>(res);
      localNonce.current = Math.max(localNonce.current, body.nonce ?? 0);
      setAccount(body);
      bumpNonce((n) => n + 1);
    }
  }

  async function onHex(value: string) {
    setHex(value);
    const token = ++keyToken.current;
    const clean = value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      setKey(null);
      setKeyError(clean ? "key must be 64 hex chars" : "");
      return;
    }
    try {
      const secret = secretFromHex(clean);
      const trader = await publicHex(secret);
      if (token !== keyToken.current) return;
      setKey({ secret, trader });
      setKeyError("");
    } catch (err) {
      if (token !== keyToken.current) return;
      setKey(null);
      setKeyError(errorMessage(err));
    }
  }

  async function onGenerate() {
    const token = ++keyToken.current;
    const next = await generateKey();
    if (token !== keyToken.current) return;
    setHex(next.hex);
    setKey({ secret: next.secret, trader: next.trader });
    setKeyError("");
  }

  async function place() {
    if (!key || !selected || busy.current) return;
    const size = tryScaled(form.size);
    const price = form.type === "market" ? marketPrice(form.side, book) : tryScaled(form.price);
    if (size == null || price == null) {
      setBad(true);
      setNote(
        form.type === "market" ? "no quote for a market order" : "size and price must be numbers",
      );
      return;
    }
    if (gridNote(market, size, price, form.type)) return;
    if (size <= 0n || price <= 0n) {
      setBad(true);
      setNote("size and price must be positive");
      return;
    }
    busy.current = true;
    setPending(true);
    const sentNonce = Math.max(localNonce.current, account?.nonce ?? 0) + 1;
    const id = nextId.current;
    const body = {
      kind: "place_order" as const,
      order: {
        id,
        trader: key.trader,
        market: selected,
        side: form.side,
        type: form.type,
        price,
        size,
        reduce_only: form.reduceOnly,
      },
    };
    try {
      await signAndPost(key.secret, body, sentNonce);
      localNonce.current = sentNonce;
      nextId.current = id + 1;
      bumpNonce((n) => n + 1);
      setBad(false);
      setNote("accepted nonce " + sentNonce);
    } catch (err) {
      if (err instanceof TxError && err.status === 400) await resyncNonce();
      setBad(true);
      setNote(errorMessage(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function onCancel(order: OpenOrder) {
    if (!key || busy.current) return;
    busy.current = true;
    setPending(true);
    const sentNonce = Math.max(localNonce.current, account?.nonce ?? 0) + 1;
    const body = {
      kind: "cancel_order" as const,
      trader: key.trader,
      market: order.market,
      order_id: order.id,
    };
    try {
      await signAndPost(key.secret, body, sentNonce);
      localNonce.current = sentNonce;
      bumpNonce((n) => n + 1);
      setBad(false);
      setNote("accepted nonce " + sentNonce);
    } catch (err) {
      if (err instanceof TxError && err.status === 400) await resyncNonce();
      setBad(true);
      setNote(errorMessage(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="app">
      <Header
        status={status}
        ws={ws}
        market={market}
        markets={markets}
        selected={selected}
        onSelect={setSelected}
        last={prints[0]}
      />
      <Chart market={selected} points={series[selected] || {}} />
      <Ladder
        market={selected}
        book={book}
        prints={prints}
        onPrice={(px) => patch({ price: unscale(px), type: "limit" })}
      />
      <section className="side">
        <KeyBox
          hex={hex}
          trader={key?.trader || ""}
          error={keyError}
          onHex={(value) => void onHex(value)}
          onGenerate={() => void onGenerate()}
        />
        <div className="pad">
          <b>account</b> {account ? "" : "none"}
          <div>collateral {fmt(account?.collateral ?? 0)}</div>
          <div>value {fmt(account?.account_value ?? 0)}</div>
          <div>margin {fmt(account?.maintenance_margin ?? 0)}</div>
        </div>
        <OrderForm
          form={form}
          patch={patch}
          market={market}
          book={book}
          nonce={nonce}
          orderId={nextId.current}
          pending={pending}
          note={note}
          bad={bad}
          onSubmit={() => void place()}
        />
        <OpenOrders orders={orders} onCancel={(order) => void onCancel(order)} />
      </section>
      <Dock
        tab={tab}
        setTab={setTab}
        account={account}
        markets={markets}
        orders={orders}
        onCancel={(order) => void onCancel(order)}
        prints={prints}
        blocks={feed}
        fills={fills}
        history={history}
        funding={funding}
      />
    </div>
  );
}

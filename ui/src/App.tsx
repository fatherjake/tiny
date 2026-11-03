import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { Chart } from "./components/Chart";
import { Dock, type DockTab } from "./components/Dock";
import { Header } from "./components/Header";
import { KeyBox } from "./components/KeyBox";
import { Ladder } from "./components/Ladder";
import { OpenOrders } from "./components/OpenOrders";
import { OrderForm } from "./components/OrderForm";
import { useWebSocket } from "./hooks/useWebSocket";
import { TxError, generateKey, publicHex, readJson, secretFromHex, signAndPost } from "./lib/api";
import { bytesToHex } from "./lib/encode";
import { closeOrder, currentPrice, outcome } from "./lib/orders";
import { unscale, usd } from "./lib/scale";
import { keyFromSignature, keyMessage } from "./lib/wallet";
import { applyCandles, rememberPrint, seed } from "./lib/series";
import type {
  AccountView,
  BlockMsg,
  Depth,
  FundingRow,
  MarketInfo,
  OpenOrder,
  Position,
  OrderDraft,
  Series,
  Status,
  StoredCandle,
  StoredOrder,
  StoredTrade,
  Trade,
} from "./types";

const REFRESH_MS = 250;
const FEED_LIMIT = 50;

type TraderKey = { secret: Uint8Array; trader: string };

// Order ids are global on the chain, so start from the clock rather than 1.
const firstOrderId = () => Date.now() * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message || String(err) : String(err);
}

async function everyTrade(market: string): Promise<StoredTrade[] | null> {
  const rows: StoredTrade[] = [];
  let cursor: StoredTrade | null = null;
  for (;;) {
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
    const oldest = page[page.length - 1];
    if (
      cursor &&
      cursor.id === oldest.id &&
      cursor.height === oldest.height &&
      cursor.tx_index === oldest.tx_index
    ) {
      return rows;
    }
    cursor = oldest;
  }
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
    usd: "100",
    price: "",
    reduceOnly: false,
  });
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [pending, setPending] = useState(false);
  const localNonce = useRef(0);
  const nextId = useRef(firstOrderId());
  const awaiting = useRef<number | null>(null);
  const busy = useRef(false);
  const keyToken = useRef(0);
  const pricedFor = useRef("");
  // Bumped on new blocks, at most every REFRESH_MS, so account views refetch when one lands.
  const [landed, setLanded] = useState(0);
  const lastLanded = useRef(0);
  const [, bumpNonce] = useState(0);
  const { address: wallet } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const ws = useWebSocket("/ws", (msg) => {
    if (msg.type === "block") {
      const now = Date.now();
      if (now - lastLanded.current >= REFRESH_MS) {
        lastLanded.current = now;
        setLanded((n) => n + 1);
      }
      setFeed((xs) => [msg, ...xs].slice(0, FEED_LIMIT));
      setStatus((prev) => ({ ...(prev ?? {}), height: msg.height, view: msg.view, tip: msg.hash }));
      fetch("/markets")
        .then(async (res) => {
          if (res.ok) setMarkets(await readJson<MarketInfo[]>(res));
        })
        .catch(() => {});
    } else if (msg.type === "book") {
      setBooks((prev) => ({ ...prev, [msg.market]: msg }));
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
    const load = async (scope: "all" | number) => {
      const market = encodeURIComponent(selected);
      const tradePromise =
        scope === "all"
          ? everyTrade(market)
          : fetch("/trades/" + market + "?limit=" + scope).then(async (res) =>
              res.ok ? readJson<StoredTrade[]>(res) : null,
            );
      const [rows, minuteRes, fundRes] = await Promise.all([
        tradePromise,
        fetch("/candles/" + market + "?interval=1m"),
        fetch("/funding/" + market + "?limit=50"),
      ]);
      if (stop) return;
      const minutes = minuteRes.ok ? await readJson<StoredCandle[]>(minuteRes) : null;
      if (rows) setPrints(rows.slice(0, 40).map(asPrint));
      if (rows || minutes) {
        setSeries((prev) => {
          let current = prev[selected] || {};
          if (minutes) current = applyCandles(current, minutes);
          const seeded = rows
            ? seed(
                current,
                rows.map((row) => ({ height: row.height, price: row.price })),
              )
            : current;
          return { ...prev, [selected]: seeded };
        });
      }
      if (fundRes.ok) setFunding(await readJson<FundingRow[]>(fundRes));
    };
    let id = 0;
    load("all")
      .then(async () => {
        if (stop) return;
        const res = await fetch("/book/" + encodeURIComponent(selected) + "?levels=20");
        if (stop || !res.ok) return;
        const book = await readJson<Depth>(res);
        setBooks((prev) => ({ ...prev, [selected]: book }));
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
  }, [key, landed]);

  useEffect(() => {
    localNonce.current = 0;
    setOpenOrders([]);
    setHistory([]);
    setFills([]);
    setAccount(null);
    awaiting.current = null;
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
  }, [key, landed]);

  useEffect(() => {
    const row = history.find((item) => Number(item.order_id) === awaiting.current);
    if (!row) return;
    awaiting.current = null;
    setBad(row.status === "rejected");
    setNote(outcome(row));
  }, [history]);

  const patch = (part: Partial<OrderDraft>) => setForm((prev) => ({ ...prev, ...part }));
  const nonce = Math.max(localNonce.current, account?.nonce ?? 0) + 1;
  const market = markets.find((item) => item.name === selected) ?? null;
  const book = books[selected] ?? null;
  const orders = openOrders;
  const prefill = currentPrice(market);

  useEffect(() => {
    if (prefill == null || pricedFor.current === selected) return;
    pricedFor.current = selected;
    patch({ price: unscale(prefill) });
  }, [selected, prefill]);

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

  async function onWallet() {
    if (!wallet) return;
    const token = ++keyToken.current;
    try {
      const signature = await signMessageAsync({ message: keyMessage(wallet) });
      const secret = await keyFromSignature(signature);
      const trader = await publicHex(secret);
      if (token !== keyToken.current) return;
      setHex(bytesToHex(secret));
      setKey({ secret, trader });
      setKeyError("");
    } catch (err) {
      if (token === keyToken.current) setKeyError(errorMessage(err).split("\n")[0]);
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

  // The form has already turned dollars into a base size on the lot and checked the margin.
  async function place(size: bigint, price: bigint) {
    if (!selected || busy.current) return;
    if (!key) {
      setBad(true);
      setNote("enter or generate a private key first");
      return;
    }
    if (size <= 0n || price <= 0n) {
      setBad(true);
      setNote("size and price must be positive");
      return;
    }
    await sendOrder(key, {
      market: selected,
      side: form.side,
      type: form.type,
      price,
      size,
      reduce_only: form.reduceOnly,
    });
  }

  async function onClose(pos: Position) {
    if (!key || busy.current) return;
    const order = closeOrder(pos, books[pos.market] ?? null);
    if (!order) {
      setBad(true);
      setNote("no quote to close " + pos.market + " against");
      return;
    }
    await sendOrder(key, { market: pos.market, type: "market", reduce_only: true, ...order });
  }

  async function sendOrder(
    key: TraderKey,
    order: {
      market: string;
      side: "buy" | "sell";
      type: "limit" | "market";
      price: bigint;
      size: bigint;
      reduce_only: boolean;
    },
  ) {
    busy.current = true;
    setPending(true);
    const sentNonce = Math.max(localNonce.current, account?.nonce ?? 0) + 1;
    const id = nextId.current;
    const body = {
      kind: "place_order" as const,
      order: { id, trader: key.trader, ...order },
    };
    try {
      await signAndPost(key.secret, body, sentNonce);
      localNonce.current = sentNonce;
      nextId.current = id + 1;
      awaiting.current = id;
      bumpNonce((n) => n + 1);
      setBad(false);
      setNote("order " + id + " sent, waiting for a block");
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
        funding={funding}
        markets={markets}
        blocks={feed}
        onPrice={(px) => patch({ price: unscale(px), type: "limit" })}
      />
      <section className="side">
        <KeyBox
          hex={hex}
          trader={key?.trader || ""}
          error={keyError}
          onHex={(value) => void onHex(value)}
          onGenerate={() => void onGenerate()}
          wallet={wallet}
          onWallet={() => void onWallet()}
        />
        <div className="pad">
          <b>account</b> {account ? "" : "none"}
          <div>collateral {usd(account?.collateral ?? 0)}</div>
          <div>value {usd(account?.account_value ?? 0)}</div>
          <div>margin {usd(account?.maintenance_margin ?? 0)}</div>
        </div>
        <OrderForm
          form={form}
          patch={patch}
          market={market}
          markets={markets}
          book={book}
          account={account}
          orders={orders}
          nonce={nonce}
          orderId={nextId.current}
          pending={pending}
          note={note}
          bad={bad}
          onSubmit={(size, price) => void place(size, price)}
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
        onClose={(pos) => void onClose(pos)}
        fills={fills}
        history={history}
      />
    </div>
  );
}

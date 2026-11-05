import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { Chart } from "./components/Chart";
import { Dock, type DockTab } from "./components/Dock";
import { Header } from "./components/Header";
import { Ladder } from "./components/Ladder";
import { OrderForm } from "./components/OrderForm";
import { Wallet } from "./components/Wallet";
import { useWebSocket } from "./hooks/useWebSocket";
import { TxError, publicHex, readJson, signAndPost } from "./lib/api";
import { closeOrder, currentPrice, outcome } from "./lib/orders";
import { unscale } from "./lib/scale";
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
const TICK_TRADES = 2_000;
const DOCK_KEY = "tiny.dock";
const DOCK_DEFAULT = 200;
const DOCK_MIN = 60;
const DOCK_ROOM = 200; // left for the header, chart and book above the dock

// The dock height is a per-browser preference. Storage can be missing or blocked.
function savedDock(): number {
  try {
    const value = Number(localStorage.getItem(DOCK_KEY));
    return value > 0 ? value : DOCK_DEFAULT;
  } catch {
    return DOCK_DEFAULT;
  }
}

type TraderKey = { secret: Uint8Array; trader: string };

// Order ids are global on the chain, so start from the clock rather than 1.
const firstOrderId = () => Date.now() * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message || String(err) : String(err);
}

// The newest `most` trades, a page at a time. The tick chart only needs the recent ones.
async function recentTrades(market: string, most: number): Promise<StoredTrade[] | null> {
  const rows: StoredTrade[] = [];
  let cursor: StoredTrade | null = null;
  while (rows.length < most) {
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
  return rows;
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
  const [dock, setDock] = useState(savedDock);
  const [key, setKey] = useState<TraderKey | null>(null);
  const [keyError, setKeyError] = useState("");
  const [signing, setSigning] = useState(false);
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
  const signedFor = useRef<string | null>(null);
  const pricedFor = useRef("");
  // Bumped on new blocks, at most every REFRESH_MS, so account views refetch when one lands.
  const [landed, setLanded] = useState(0);
  const lastLanded = useRef(0);
  const [, bumpNonce] = useState(0);
  const { address: wallet, status: walletStatus } = useAccount();
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
    // The first load takes all candles and the latest trades. Each refresh takes only the
    // candles from the last two minutes and merges them in. Each part draws when it lands.
    let since: number | null = null;
    const load = async (first: boolean) => {
      const market = encodeURIComponent(selected);
      const candles = (async () => {
        const query = since == null ? "" : "&start=" + since;
        const res = await fetch("/candles/" + market + "?interval=1m" + query);
        if (stop || !res.ok) return;
        const minutes = await readJson<StoredCandle[]>(res);
        if (stop) return;
        const latest = minutes.length ? Number(minutes[minutes.length - 1].ts) : null;
        if (latest != null) since = latest - 60_000;
        setSeries((prev) => ({ ...prev, [selected]: applyCandles(prev[selected] || {}, minutes) }));
      })();
      const trades = (async () => {
        const rows = first
          ? await recentTrades(market, TICK_TRADES)
          : await fetch("/trades/" + market + "?limit=200").then(async (res) =>
              res.ok ? readJson<StoredTrade[]>(res) : null,
            );
        if (stop || !rows) return;
        setPrints(rows.slice(0, 40).map(asPrint));
        const points = rows.map((row) => ({ height: row.height, price: row.price }));
        setSeries((prev) => ({ ...prev, [selected]: seed(prev[selected] || {}, points) }));
      })();
      const funding = (async () => {
        const res = await fetch("/funding/" + market + "?limit=50");
        if (!stop && res.ok) setFunding(await readJson<FundingRow[]>(res));
      })();
      await Promise.all([candles, trades, funding]);
    };
    let id = 0;
    load(true)
      .then(async () => {
        if (stop) return;
        const res = await fetch("/book/" + encodeURIComponent(selected) + "?levels=20");
        if (stop || !res.ok) return;
        const book = await readJson<Depth>(res);
        setBooks((prev) => ({ ...prev, [selected]: book }));
        if (!stop) {
          id = window.setInterval(() => {
            load(false).catch(() => {});
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

  // The trading key comes from a wallet signature the user asks for with "Enable trading".
  // It is dropped when the wallet disconnects or switches address.
  useEffect(() => {
    if (signedFor.current === null || signedFor.current === wallet) return;
    signedFor.current = null;
    keyToken.current++;
    setKey(null);
    setKeyError("");
    setSigning(false);
  }, [wallet]);

  async function onWallet(address: string) {
    signedFor.current = address;
    const token = ++keyToken.current;
    setKey(null);
    setKeyError("");
    setSigning(true);
    try {
      const signature = await signMessageAsync({ message: keyMessage(address) });
      const secret = await keyFromSignature(signature);
      const trader = await publicHex(secret);
      if (token !== keyToken.current) return;
      setKey({ secret, trader });
    } catch (err) {
      if (token !== keyToken.current) return;
      signedFor.current = null;
      setKeyError(errorMessage(err).split("\n")[0]);
    } finally {
      if (token === keyToken.current) setSigning(false);
    }
  }

  // The form has already turned dollars into a base size on the lot and checked the margin.
  async function place(size: bigint, price: bigint) {
    if (!selected || busy.current) return;
    if (!key) {
      setBad(true);
      setNote("connect a wallet first");
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
    <div className="app" style={{ "--dock": dock + "px" } as CSSProperties}>
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
        <Wallet
          wallet={wallet}
          trader={key?.trader ?? ""}
          account={account}
          leverage={market?.max_leverage ?? null}
          error={keyError}
          // On a page load the address is known while the wallet is still reconnecting, and
          // signing then fails, so the button waits for "connected".
          canSign={walletStatus === "connected" && !signing}
          signing={signing}
          onSign={() => wallet && void onWallet(wallet)}
        />
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
        onResize={(height) => {
          const next = Math.round(
            Math.min(Math.max(height, DOCK_MIN), window.innerHeight - DOCK_ROOM),
          );
          setDock(next);
          try {
            localStorage.setItem(DOCK_KEY, String(next));
          } catch {
            /* keep it for this page only */
          }
        }}
      />
    </div>
  );
}

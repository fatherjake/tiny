import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Chart } from "./components/Chart";
import { Dock, type DockTab } from "./components/Dock";
import { Header } from "./components/Header";
import { Ladder } from "./components/Ladder";
import { OrderForm } from "./components/OrderForm";
import { Wallet } from "./components/Wallet";
import { useMarketData } from "./hooks/useMarketData";
import { useOrderActions } from "./hooks/useOrderActions";
import { useTraderSession } from "./hooks/useTraderSession";
import { useTradingAccount } from "./hooks/useTradingAccount";
import { currentPrice } from "./lib/orders";
import { unscale } from "./lib/scale";
import type { OrderDraft } from "./types";

const DOCK_KEY = "tiny.dock";
function savedDock(): number { try { const value = Number(localStorage.getItem(DOCK_KEY)); return value > 0 ? value : 200; } catch { return 200; } }

export function App() {
  const data = useMarketData();
  const trader = useTraderSession();
  const account = useTradingAccount(trader.key, data.landed);
  const actions = useOrderActions(trader.key, account.account, account.history, data.books, account.refreshAccount);
  const [tab, setTab] = useState<DockTab>("positions");
  const [dock, setDock] = useState(savedDock);
  const [form, setForm] = useState<OrderDraft>({ side: "buy", type: "limit", usd: "100", price: "", reduceOnly: false });
  const pricedFor = useRef("");
  const market = data.markets.find((item) => item.name === data.selected) ?? null;
  const book = data.books[data.selected] ?? null;
  const patch = (part: Partial<OrderDraft>) => setForm((prev) => ({ ...prev, ...part }));
  const prefill = currentPrice(market);
  useEffect(() => {
    if (prefill == null || pricedFor.current === data.selected) return;
    pricedFor.current = data.selected;
    patch({ price: unscale(prefill) });
  }, [data.selected, prefill]);
  return <div className="app" style={{ "--dock": dock + "px" } as CSSProperties}>
    <Header status={data.status} ws={data.ws} market={market} markets={data.markets} selected={data.selected} onSelect={data.setSelected} last={data.prints[0]} />
    <Chart market={data.selected} points={data.series[data.selected] || {}} />
    <Ladder market={data.selected} book={book} prints={data.prints} funding={data.funding} markets={data.markets} blocks={data.feed} onPrice={(price) => patch({ price: unscale(price), type: "limit" })} />
    <section className="side">
      <Wallet wallet={trader.wallet} trader={trader.key?.trader ?? ""} account={account.account} leverage={market?.max_leverage ?? null} error={trader.error} canSign={trader.canSign} signing={trader.signing} onSign={() => void trader.enable()} />
      <OrderForm form={form} patch={patch} market={market} markets={data.markets} book={book} account={account.account} orders={account.orders} nonce={actions.nonce} orderId={actions.orderId} pending={actions.pending} note={actions.note} bad={actions.bad} onSubmit={(size, price) => void actions.send({ market: data.selected, side: form.side, type: form.type, price, size, reduce_only: form.reduceOnly })} />
    </section>
    <Dock tab={tab} setTab={setTab} account={account.account} markets={data.markets} orders={account.orders} onCancel={(order) => void actions.cancel(order)} onClose={(pos) => void actions.close(pos)} fills={account.fills} history={account.history} onResize={(height) => { const next = Math.round(Math.min(Math.max(height, 60), window.innerHeight - 200)); setDock(next); try { localStorage.setItem(DOCK_KEY, String(next)); } catch { /* Keep page preference. */ } }} />
  </div>;
}

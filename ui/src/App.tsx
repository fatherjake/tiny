import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useState,
} from "react";
import { Chart } from "./components/Chart";
import { Dock, type DockTab } from "./components/Dock";
import { Header } from "./components/Header";
import { Ladder } from "./components/Ladder";
import { OrderForm } from "./components/OrderForm";
import { Wallet } from "./components/Wallet";
import { useMarketsSelect } from "./hooks/useMarket";
import { useMarketStream } from "./hooks/useMarketStream";
import { useOrderActions } from "./hooks/useOrderActions";
import { useTraderSession } from "./hooks/useTraderSession";
import { unscale } from "./lib/scale";
import type { OrderDraft, Scaled } from "./types";
import { dockHeight, firstName, saveDock, savedDock } from "./App.utils";

const PerfPanel = import.meta.env.DEV
  ? lazy(() =>
      import("./components/PerfPanel").then((mod) => ({
        default: mod.PerfPanel,
      })),
    )
  : null;

export function App() {
  const ws = useMarketStream();
  const [chosen, setChosen] = useState("");
  const first = useMarketsSelect(firstName) ?? "";
  const selected = chosen || first;
  const leverage =
    useMarketsSelect(
      (markets) => markets.find((m) => m.name === selected)?.max_leverage,
    ) ?? null;
  const trader = useTraderSession();
  const traderId = trader.key?.trader ?? "";
  const actions = useOrderActions(trader.key);
  const [tab, setTab] = useState<DockTab>("positions");
  const [picked, setPicked] = useState<string | null>(null);
  const onPick = useCallback((market: string) => {
    setPicked((prev) => (prev === market ? null : market));
    setChosen(market);
  }, []);
  const [dock, setDock] = useState(savedDock);
  const [form, setForm] = useState<OrderDraft>({
    side: "buy",
    type: "limit",
    usd: "100",
    price: "",
    reduceOnly: false,
  });
  const patch = useCallback(
    (part: Partial<OrderDraft>) => setForm((prev) => ({ ...prev, ...part })),
    [],
  );
  const onPrice = useCallback(
    (price: Scaled) => patch({ price: unscale(price), type: "limit" }),
    [patch],
  );
  return (
    <div
      className={ws === "live" ? "app" : "app stale"}
      style={{ "--dock": dock + "px" } as CSSProperties}
    >
      <Header ws={ws} selected={selected} onSelect={setChosen} />
      <Chart market={selected} trader={traderId} picked={picked} />
      <Ladder market={selected} trader={traderId} onPrice={onPrice} />
      <section className="side">
        <Wallet
          wallet={trader.wallet}
          trader={traderId}
          leverage={leverage}
          error={trader.error}
          canSign={trader.canSign}
          signing={trader.signing}
          onSign={() => void trader.enable()}
        />
        <OrderForm
          form={form}
          patch={patch}
          selected={selected}
          trader={traderId}
          nonce={actions.nonce}
          orderId={actions.orderId}
          pending={actions.pending}
          note={actions.note}
          bad={actions.bad}
          onSubmit={(size, price) =>
            void actions.send({
              market: selected,
              side: form.side,
              type: form.type,
              price,
              size,
              reduce_only: form.reduceOnly,
            })
          }
        />
      </section>
      <Dock
        tab={tab}
        setTab={setTab}
        trader={traderId}
        onCancel={(order) => void actions.cancel(order)}
        onClose={(pos) => void actions.close(pos)}
        pick={{ picked, onPick }}
        onResize={(height) => {
          const next = dockHeight(height, window.innerHeight);
          setDock(next);
          saveDock(next);
        }}
      />
      {PerfPanel ? (
        <Suspense fallback={null}>
          <PerfPanel market={selected} />
        </Suspense>
      ) : null}
    </div>
  );
}

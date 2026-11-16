import {
  useAccount,
  useFills,
  useOpenOrders,
  useOrderHistory,
} from "../hooks/useAccount";
import type { OpenOrder, Position } from "../types";
import { Account } from "./Account";
import { Fills, OrderHistory } from "./History";
import { OpenOrders } from "./OpenOrders";

export const DOCK_TABS = ["positions", "orders", "fills", "history"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

type Props = {
  tab: DockTab;
  setTab: (tab: DockTab) => void;
  trader: string;
  onCancel: (order: OpenOrder) => void;
  onClose: (pos: Position) => void;
  onResize: (height: number) => void;
};

export function Dock({
  tab,
  setTab,
  trader,
  onCancel,
  onClose,
  onResize,
}: Props) {
  return (
    <section className="dock">
      <div
        className="grip"
        onPointerDown={(event) =>
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            onResize(window.innerHeight - event.clientY);
          }
        }}
      />
      <div className="tabs">
        {DOCK_TABS.map((name) => (
          <button
            type="button"
            key={name}
            className={tab === name ? "on" : ""}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="pane">
        <Pane tab={tab} trader={trader} onCancel={onCancel} onClose={onClose} />
      </div>
    </section>
  );
}

function Pane({
  tab,
  trader,
  onCancel,
  onClose,
}: {
  tab: DockTab;
  trader: string;
  onCancel: (order: OpenOrder) => void;
  onClose: (pos: Position) => void;
}) {
  switch (tab) {
    case "positions":
      return <PositionsPane trader={trader} onClose={onClose} />;
    case "orders":
      return <OrdersPane trader={trader} onCancel={onCancel} />;
    case "fills":
      return <FillsPane trader={trader} />;
    case "history":
      return <HistoryPane trader={trader} />;
  }
}

function PositionsPane({
  trader,
  onClose,
}: {
  trader: string;
  onClose: (pos: Position) => void;
}) {
  return <Account account={useAccount(trader)} onClose={onClose} />;
}

function OrdersPane({
  trader,
  onCancel,
}: {
  trader: string;
  onCancel: (order: OpenOrder) => void;
}) {
  return <OpenOrders orders={useOpenOrders(trader)} onCancel={onCancel} />;
}

function FillsPane({ trader }: { trader: string }) {
  return <Fills rows={useFills(trader)} />;
}

function HistoryPane({ trader }: { trader: string }) {
  return <OrderHistory orders={useOrderHistory(trader)} />;
}

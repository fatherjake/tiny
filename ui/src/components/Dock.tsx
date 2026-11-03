import type {
  AccountView,
  MarketInfo,
  OpenOrder,
  Position,
  StoredOrder,
  StoredTrade,
} from "../types";
import { Account } from "./Account";
import { Fills, OrderHistory } from "./History";
import { OpenOrders } from "./OpenOrders";

export const DOCK_TABS = ["positions", "orders", "fills", "history"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

type Props = {
  tab: DockTab;
  setTab: (tab: DockTab) => void;
  account: AccountView | null;
  markets: MarketInfo[];
  orders: OpenOrder[];
  onCancel: (order: OpenOrder) => void;
  onClose: (pos: Position) => void;
  fills: StoredTrade[];
  history: StoredOrder[];
};

export function Dock({
  tab,
  setTab,
  account,
  markets,
  orders,
  onCancel,
  onClose,
  fills,
  history,
}: Props) {
  return (
    <section className="dock">
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
      <div className="pane">{pane(tab, account, markets, orders, onCancel, onClose, fills, history)}</div>
    </section>
  );
}

function pane(
  tab: DockTab,
  account: AccountView | null,
  markets: MarketInfo[],
  orders: OpenOrder[],
  onCancel: (order: OpenOrder) => void,
  onClose: (pos: Position) => void,
  fills: StoredTrade[],
  history: StoredOrder[],
) {
  switch (tab) {
    case "positions":
      return <Account account={account} markets={markets} onClose={onClose} />;
    case "orders":
      return <OpenOrders orders={orders} onCancel={onCancel} />;
    case "fills":
      return <Fills rows={fills} />;
    case "history":
      return <OrderHistory orders={history} />;
  }
}

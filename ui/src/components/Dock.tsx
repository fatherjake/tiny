import type { AccountView, BlockMsg, MarketInfo, OpenOrder, Trade } from "../types";
import { Account } from "./Account";
import { Feed } from "./Feed";
import { OpenOrders } from "./OpenOrders";
import { Tape } from "./Tape";

export const DOCK_TABS = ["positions", "orders", "trades", "blocks"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

type Props = {
  tab: DockTab;
  setTab: (tab: DockTab) => void;
  account: AccountView | null;
  markets: MarketInfo[];
  orders: OpenOrder[];
  onCancel: (order: OpenOrder) => void;
  prints: Trade[];
  blocks: BlockMsg[];
};

export function Dock({ tab, setTab, account, markets, orders, onCancel, prints, blocks }: Props) {
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
      <div className="pane">{pane(tab, account, markets, orders, onCancel, prints, blocks)}</div>
    </section>
  );
}

function pane(
  tab: DockTab,
  account: AccountView | null,
  markets: MarketInfo[],
  orders: OpenOrder[],
  onCancel: (order: OpenOrder) => void,
  prints: Trade[],
  blocks: BlockMsg[],
) {
  switch (tab) {
    case "positions":
      return <Account account={account} markets={markets} />;
    case "orders":
      return <OpenOrders orders={orders} onCancel={onCancel} />;
    case "trades":
      return <Tape prints={prints} />;
    case "blocks":
      return <Feed blocks={blocks} />;
  }
}

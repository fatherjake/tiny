import type {
  AccountView,
  BlockMsg,
  FundingRow,
  MarketInfo,
  OpenOrder,
  StoredOrder,
  StoredTrade,
  Trade,
} from "../types";
import { Account } from "./Account";
import { Feed } from "./Feed";
import { Fills, Funding, OrderHistory } from "./History";
import { OpenOrders } from "./OpenOrders";
import { Tape } from "./Tape";

export const DOCK_TABS = ["positions", "orders", "fills", "history", "funding", "trades", "blocks"] as const;
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
  fills: StoredTrade[];
  history: StoredOrder[];
  funding: FundingRow[];
};

export function Dock({
  tab,
  setTab,
  account,
  markets,
  orders,
  onCancel,
  prints,
  blocks,
  fills,
  history,
  funding,
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
      <div className="pane">
        {pane(tab, account, markets, orders, onCancel, prints, blocks, fills, history, funding)}
      </div>
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
  fills: StoredTrade[],
  history: StoredOrder[],
  funding: FundingRow[],
) {
  switch (tab) {
    case "positions":
      return <Account account={account} markets={markets} />;
    case "orders":
      return <OpenOrders orders={orders} onCancel={onCancel} />;
    case "fills":
      return <Fills rows={fills} />;
    case "history":
      return <OrderHistory orders={history} />;
    case "funding":
      return <Funding rows={funding} />;
    case "trades":
      return <Tape prints={prints} />;
    case "blocks":
      return <Feed blocks={blocks} />;
  }
}

import { useMemo, useState } from "react";

import { useOpenOrders } from "../hooks/useAccount";

import {
  useBook,
  useFeed,
  useFunding,
  useMarkets,
  useTrades,
} from "../hooks/useMarket";
import type { Scaled } from "../types";
import { Book } from "./Book";
import { Feed } from "./Feed";
import { Funding } from "./History";
import { latest, mineKeys } from "./Ladder.utils";
import { Tape } from "./Tape";

type Props = {
  market: string;
  trader: string;
  onPrice: (price: Scaled) => void;
};

const TABS = [
  ["book", "Order Book"],
  ["trades", "Trades"],
  ["funding", "Funding"],
  ["blocks", "Blocks"],
] as const;

function BookTab({ market, trader, onPrice }: Props) {
  const orders = useOpenOrders(trader);
  const mine = useMemo(() => mineKeys(orders, market), [orders, market]);
  return <Book book={useBook(market)} mine={mine} onPrice={onPrice} />;
}

function TradesTab({ market }: { market: string }) {
  return <Tape prints={useTrades(market, latest) ?? []} tint />;
}

function FundingTab({ market }: { market: string }) {
  return <Funding rows={useFunding(market)} markets={useMarkets()} />;
}

function BlocksTab() {
  return <Feed blocks={useFeed()} />;
}

export function Ladder({ market, trader, onPrice }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("book");
  return (
    <section className="depth">
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? "on" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "book" ? (
        <BookTab market={market} trader={trader} onPrice={onPrice} />
      ) : null}
      {tab === "trades" ? <TradesTab market={market} /> : null}
      {tab === "funding" ? <FundingTab market={market} /> : null}
      {tab === "blocks" ? <BlocksTab /> : null}
    </section>
  );
}

import { useState } from "react";

import {
  useBook,
  useFeed,
  useFunding,
  useMarkets,
  useTrades,
} from "../hooks/useMarket";
import type { Scaled, Trade } from "../types";
import { Book } from "./Book";
import { Feed } from "./Feed";
import { Funding } from "./History";
import { Tape } from "./Tape";

type Props = {
  market: string;
  onPrice: (price: Scaled) => void;
};

const TABS = [
  ["book", "Order Book"],
  ["trades", "Trades"],
  ["funding", "Funding"],
  ["blocks", "Blocks"],
] as const;

const PRINTS = 40;
const latest = (rows: Trade[]) => rows.slice(0, PRINTS);

function BookTab({ market, onPrice }: Props) {
  return <Book book={useBook(market)} onPrice={onPrice} />;
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

export function Ladder({ market, onPrice }: Props) {
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
      {tab === "book" ? <BookTab market={market} onPrice={onPrice} /> : null}
      {tab === "trades" ? <TradesTab market={market} /> : null}
      {tab === "funding" ? <FundingTab market={market} /> : null}
      {tab === "blocks" ? <BlocksTab /> : null}
    </section>
  );
}

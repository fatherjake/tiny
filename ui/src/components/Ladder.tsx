import { useState } from "react";

import type { BlockMsg, Depth, FundingRow, MarketInfo, Scaled, Trade } from "../types";
import { Book } from "./Book";
import { Feed } from "./Feed";
import { Funding } from "./History";
import { Tape } from "./Tape";

type Props = {
  market: string;
  book: Depth | null;
  prints: Trade[];
  funding: FundingRow[];
  markets: MarketInfo[];
  blocks: BlockMsg[];
  onPrice: (price: Scaled) => void;
};

const TABS = [
  ["book", "Order Book"],
  ["trades", "Trades"],
  ["funding", "Funding"],
  ["blocks", "Blocks"],
] as const;

export function Ladder({ market, book, prints, funding, markets, blocks, onPrice }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("book");
  const mine = prints.filter((print) => print.market === market);
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
      {tab === "book" ? <Book book={book} onPrice={onPrice} /> : null}
      {tab === "trades" ? <Tape prints={mine} tint /> : null}
      {tab === "funding" ? <Funding rows={funding} markets={markets} /> : null}
      {tab === "blocks" ? <Feed blocks={blocks} /> : null}
    </section>
  );
}

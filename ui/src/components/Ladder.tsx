import { useState } from "react";

import type { Depth, Scaled, Trade } from "../types";
import { Book } from "./Book";
import { Tape } from "./Tape";

type Props = {
  market: string;
  book: Depth | null;
  prints: Trade[];
  onPrice: (price: Scaled) => void;
};

const TABS = [
  ["book", "Order Book"],
  ["trades", "Trades"],
] as const;

export function Ladder({ market, book, prints, onPrice }: Props) {
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
      {tab === "book" ? <Book book={book} onPrice={onPrice} /> : <Tape prints={mine} tint />}
    </section>
  );
}

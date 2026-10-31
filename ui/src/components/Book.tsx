import type { CSSProperties } from "react";

import { spreadMid } from "../lib/series";
import { bi, fmt } from "../lib/scale";
import type { Depth, Level, Scaled } from "../types";

type Props = {
  book: Depth | null;
  onPrice: (price: Scaled) => void;
};

type Row = { price: Scaled; size: bigint; total: bigint };

function totals(rows: Level[]): Row[] {
  let sum = 0n;
  return rows.map((level) => {
    const size = bi(level[1]);
    sum += size;
    return { price: level[0], size, total: sum };
  });
}

function depthStyle(pct: number): CSSProperties {
  return { "--w": pct + "%" } as CSSProperties;
}

export function Book({ book, onPrice }: Props) {
  const askRows = totals((book?.asks ?? []).slice(0, 14)).reverse();
  const bidRows = totals((book?.bids ?? []).slice(0, 14));
  let max = 1n;
  for (const row of askRows.concat(bidRows)) if (row.total > max) max = row.total;
  const levelRow = (row: Row, side: "ask" | "bid", key: string) => {
    let pct = Number((row.total * 100n) / max);
    if (row.total > 0n && pct < 1) pct = 1;
    return (
      <tr key={key} className={side} style={depthStyle(pct)}>
        <td className="l">
          <button type="button" className={"px " + side} onClick={() => onPrice(row.price)}>
            {fmt(row.price)}
          </button>
        </td>
        <td>{fmt(row.size)}</td>
        <td>{fmt(row.total)}</td>
      </tr>
    );
  };
  const { spread, pct } = spreadMid(book);
  return (
    <section className="book">
      <table>
        <thead>
          <tr>
            <td className="l">Price</td>
            <td>Size</td>
            <td>Total</td>
          </tr>
        </thead>
        <tbody>
          {askRows.map((row) => levelRow(row, "ask", "a" + row.price))}
          <tr key="mid" className="mid">
            <td className="l">Spread</td>
            <td>{fmt(spread)}</td>
            <td>{pct}</td>
          </tr>
          {bidRows.map((row) => levelRow(row, "bid", "b" + row.price))}
        </tbody>
      </table>
    </section>
  );
}

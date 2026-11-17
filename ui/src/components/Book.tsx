import { useFlash } from "../hooks/useFlash";
import { spreadMid } from "../lib/series";
import { fmt, usd } from "../lib/scale";
import type { Depth, Scaled } from "../types";
import {
  type Row,
  depthPct,
  depthStyle,
  maxTotal,
  mineKey,
  totals,
} from "./Book.utils";

type Props = {
  book: Depth | null;
  mine: Set<string>;
  onPrice: (price: Scaled) => void;
};

function LevelRow({
  row,
  side,
  pct,
  mine,
  onPrice,
}: {
  row: Row;
  side: "ask" | "bid";
  pct: number;
  mine: boolean;
  onPrice: (price: Scaled) => void;
}) {
  const flash = useFlash(row.size);
  const className = [side, flash, mine ? "mine" : ""].filter(Boolean).join(" ");
  return (
    <tr className={className} style={depthStyle(pct)}>
      <td className="l">
        <button
          type="button"
          className={"px " + side}
          onClick={() => onPrice(row.price)}
        >
          {usd(row.price)}
        </button>
      </td>
      <td>{fmt(row.size)}</td>
      <td>{fmt(row.total)}</td>
    </tr>
  );
}

export function Book({ book, mine, onPrice }: Props) {
  const askRows = totals(book?.asks ?? []).reverse();
  const bidRows = totals(book?.bids ?? []);
  const max = maxTotal(askRows.concat(bidRows));
  const levelRow = (row: Row, side: "ask" | "bid", key: string) => {
    const pct = depthPct(row.total, max);
    return (
      <LevelRow
        key={key}
        row={row}
        side={side}
        pct={pct}
        mine={mine.has(mineKey(side, row.price))}
        onPrice={onPrice}
      />
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
        <tbody className="asks">
          {askRows.map((row) => levelRow(row, "ask", "a" + row.price))}
        </tbody>
        <tbody>
          <tr className="mid">
            <td className="l">Spread</td>
            <td>{usd(spread)}</td>
            <td>{pct}</td>
          </tr>
        </tbody>
        <tbody className="bids">
          {bidRows.map((row) => levelRow(row, "bid", "b" + row.price))}
        </tbody>
      </table>
    </section>
  );
}

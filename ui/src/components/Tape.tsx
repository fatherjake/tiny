import { useState } from "react";

import { fmt, usd } from "../lib/scale";
import type { Trade } from "../types";

type Props = {
  prints: Trade[];
  tint?: boolean;
};

const seqs = (prints: Trade[]) => new Set(prints.map((print) => print.seq));

export function Tape({ prints, tint = false }: Props) {
  const [first, setFirst] = useState(() =>
    prints.length ? seqs(prints) : null,
  );
  if (first === null && prints.length) setFirst(seqs(prints));
  const rows = prints.slice(0, 40).map((print) => (
    <tr
      key={"p" + print.seq}
      className={first && !first.has(print.seq) ? "fresh" : undefined}
    >
      <td>{print.height}</td>
      <td className="l">{print.side}</td>
      <td className={tint ? (print.side === "buy" ? "bid" : "ask") : undefined}>
        {usd(print.price)}
      </td>
      <td>{fmt(print.size)}</td>
    </tr>
  ));
  return (
    <section className="tape">
      <table>
        <thead>
          <tr>
            <td>h</td>
            <td className="l">side</td>
            <td>price</td>
            <td>size</td>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td className="l" colSpan={4}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

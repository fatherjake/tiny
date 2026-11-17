import { usePause } from "../hooks/usePause";
import { positionValue } from "../lib/orders";
import { bi, fmt, usd } from "../lib/scale";
import type { Trade } from "../types";
import { PausePill } from "./PausePill";

const TAPE_ROWS = 40;

type Props = {
  prints: Trade[];
  tint?: boolean;
};

export function Tape({ prints, tint = false }: Props) {
  const pause = usePause(prints);
  const rows = pause.rows.slice(0, TAPE_ROWS).map((print) => (
    <tr key={"p" + print.seq}>
      <td className="l">{print.side}</td>
      <td className={tint ? (print.side === "buy" ? "bid" : "ask") : undefined}>
        {usd(print.price)}
      </td>
      <td>
        {fmt(print.size)}{" "}
        <span className="muted">
          {usd(positionValue(bi(print.size), print.price))}
        </span>
      </td>
    </tr>
  ));
  return (
    <section className="tape" ref={pause.ref} onScroll={pause.onScroll}>
      <table>
        <thead>
          <tr>
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
              <td className="l" colSpan={3}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <PausePill paused={pause.paused} onResume={pause.resume} />
    </section>
  );
}

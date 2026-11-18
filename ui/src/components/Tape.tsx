import { type UIEvent, useState } from "react";

import { usePause } from "../hooks/usePause";
import { positionValue } from "../lib/orders";
import { bi, fmt, usd } from "../lib/scale";
import type { Trade } from "../types";
import { PausePill } from "./PausePill";
import { ROW_H, visible } from "./Tape.utils";

type Props = {
  prints: Trade[];
  tint?: boolean;
};

export function Tape({ prints, tint = false }: Props) {
  const pause = usePause(prints);
  const [view, setView] = useState({ top: 0, height: 0 });
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    setView({ top: el.scrollTop, height: el.clientHeight });
    pause.onScroll(event);
  };
  const resume = () => {
    pause.resume();
    setView({ top: 0, height: 0 });
  };
  const rows = pause.rows;
  const [start, end] = visible(rows.length, view.top, view.height);
  return (
    <section className="tape" ref={pause.ref} onScroll={onScroll}>
      <div className="print head">
        <span className="l">side</span>
        <span>price</span>
        <span>size</span>
      </div>
      {rows.length ? (
        <div className="prints" style={{ height: rows.length * ROW_H }}>
          {rows.slice(start, end).map((print, i) => (
            <div
              key={"p" + print.seq}
              className="print"
              style={{ top: (start + i) * ROW_H, height: ROW_H }}
            >
              <span className="l">{print.side}</span>
              <span
                className={
                  tint ? (print.side === "buy" ? "bid" : "ask") : undefined
                }
              >
                {usd(print.price)}
              </span>
              <span>
                {fmt(print.size)}{" "}
                <span className="muted">
                  {usd(positionValue(bi(print.size), print.price))}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="print empty">
          <span className="l">none</span>
        </div>
      )}
      <PausePill paused={pause.paused} onResume={resume} />
    </section>
  );
}

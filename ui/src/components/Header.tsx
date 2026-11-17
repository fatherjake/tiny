import { useEffect, useState } from "react";

import {
  useInclusionMs,
  useLastBlockAt,
  useMarket,
  useMarketsSelect,
  useStatus,
} from "../hooks/useMarket";
import { short, usd } from "../lib/scale";
import { annual, names, sinceLabel } from "./Header.utils";

type Props = {
  ws: string;
  selected: string;
  onSelect: (name: string) => void;
};

function SinceBlock() {
  const at = useLastBlockAt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  const ago = sinceLabel(at, now);
  return (
    <span title="since the last block arrived">
      <b>block</b> {ago}
    </span>
  );
}

export function Header({ ws, selected, onSelect }: Props) {
  const inclusion = useInclusionMs();
  const status = useStatus();
  const market = useMarket(selected);
  const markets = useMarketsSelect(names) ?? [];
  return (
    <header>
      <div className="quote">
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          {markets.length ? (
            markets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))
          ) : (
            <option value="">tiny</option>
          )}
        </select>
        <span>
          <b>mark</b> {usd(market?.mark_price)}
        </span>
        <span>
          <b>oracle</b> {usd(market?.oracle_price)}
        </span>
        <span>
          <b>funding 1h</b> {annual(market)} APR
        </span>
      </div>
      <div className="quote">
        <span>
          <b>node</b> {status?.node ?? "-"}
        </span>
        <span>
          <b>height</b> {status?.height ?? "-"}
        </span>
        <span>
          <b>view</b> {status?.view ?? "-"}
        </span>
        <span>{short(status?.tip)}</span>
        <span title="round trip to /status">
          <b>rtt</b> {status?.rttMs == null ? "-" : status.rttMs + "ms"}
        </span>
        <SinceBlock />
        <span title="your last order, from submit to its block">
          <b>incl</b> {inclusion == null ? "-" : inclusion + "ms"}
        </span>
        <b>{ws}</b>
      </div>
    </header>
  );
}

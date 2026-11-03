import { bi, pct, short, usd } from "../lib/scale";
import type { MarketInfo, Status, Trade } from "../types";

type Props = {
  status: Status | null;
  ws: string;
  market: MarketInfo | null;
  markets: MarketInfo[];
  selected: string;
  onSelect: (name: string) => void;
  last: Trade | undefined;
};

const YEAR_MS = 365n * 24n * 3_600_000n;

// Funding paid over the last hour (or since genesis), as a yearly rate of the oracle price.
function annual(market: MarketInfo | null): string {
  const base = market?.funding_base;
  if (!market || !base || market.funding_ts == null || market.funding_index == null) return "-";
  if (market.oracle_price == null) return "-";
  const elapsed = BigInt(market.funding_ts - base.ts);
  if (elapsed <= 0n) return "-";
  const paid = bi(market.funding_index) - bi(base.index);
  return pct(paid * YEAR_MS, bi(market.oracle_price) * elapsed);
}

export function Header({ status, ws, market, markets, selected, onSelect, last }: Props) {
  return (
    <header>
      <div className="quote">
        <select value={selected} onChange={(event) => onSelect(event.target.value)}>
          {markets.length ? (
            markets.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))
          ) : (
            <option value="">tiny</option>
          )}
        </select>
        <span>
          <b>{last ? last.side : "last"}</b> {usd(last ? last.price : null)}
        </span>
        <span>
          <b>mark</b> {usd(market?.mark_price)}
        </span>
        <span>
          <b>oracle</b> {usd(market?.oracle_price)}
        </span>
        <span>
          <b>funding</b> {annual(market)} APR
        </span>
      </div>
      <div className="quote">
        <span>node {status?.node ?? "-"}</span>
        <span>height {status?.height ?? "-"}</span>
        <span>view {status?.view ?? "-"}</span>
        <span>{short(status?.tip)}</span>
        <b>{ws}</b>
      </div>
    </header>
  );
}

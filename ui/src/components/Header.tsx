import { fmt, short } from "../lib/scale";
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
          <b>{last ? last.side : "last"}</b> {fmt(last ? last.price : null)}
        </span>
        <span>
          <b>mark</b> {fmt(market?.mark_price)}
        </span>
        <span>
          <b>oracle</b> {fmt(market?.oracle_price)}
        </span>
        <span>
          <b>funding</b> {market?.funding_index ?? "-"}
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

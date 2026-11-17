import { pct } from "../lib/scale";
import type { FundingRow, MarketInfo } from "../types";

export function fundingRate(row: FundingRow, markets: MarketInfo[]): string {
  return pct(
    row.rate,
    markets.find((m) => m.name === row.market)?.oracle_price,
  );
}

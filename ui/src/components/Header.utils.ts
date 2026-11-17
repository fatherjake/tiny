import { bi, pct } from "../lib/scale";
import type { MarketInfo } from "../types";

export const names = (markets: MarketInfo[]) =>
  markets.map((item) => item.name);

export const YEAR_MS = 365n * 24n * 3_600_000n;

export function annual(market: MarketInfo | null): string {
  const base = market?.funding_base;
  if (
    !market ||
    !base ||
    market.funding_ts == null ||
    market.funding_index == null
  )
    return "-";
  if (market.oracle_price == null) return "-";
  const elapsed = BigInt(market.funding_ts - base.ts);
  if (elapsed <= 0n) return "-";
  const paid = bi(market.funding_index) - bi(base.index);
  return pct(paid * YEAR_MS, bi(market.oracle_price) * elapsed);
}

export function sinceLabel(at: number | null | undefined, now: number): string {
  return at == null ? "-" : (Math.max(0, now - at) / 1000).toFixed(1) + "s";
}

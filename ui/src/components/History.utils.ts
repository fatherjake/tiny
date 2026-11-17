import { bi, pct } from "../lib/scale";
import type { FundingRow, MarketInfo } from "../types";

export const HOUR_MS = 3_600_000;
export const YEAR_MS = 365 * 24 * HOUR_MS;

export function fundingDelta(
  row: FundingRow,
  prev: FundingRow | undefined,
): bigint | null {
  if (prev == null) return null;
  const elapsed = row.ts - prev.ts;
  if (elapsed <= 0) return null;
  return (bi(row.rate) * BigInt(HOUR_MS)) / BigInt(elapsed);
}

export function fundingApr(
  row: FundingRow,
  prev: FundingRow | undefined,
  markets: MarketInfo[],
): string {
  const oracle = markets.find((m) => m.name === row.market)?.oracle_price;
  if (prev == null || oracle == null) return "-";
  const elapsed = row.ts - prev.ts;
  if (elapsed <= 0) return "-";
  return pct(bi(row.rate) * BigInt(YEAR_MS), bi(oracle) * BigInt(elapsed));
}

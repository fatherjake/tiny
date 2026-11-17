import type { CSSProperties } from "react";

import { bi } from "../lib/scale";
import type { Level, Scaled } from "../types";

export type Row = { price: Scaled; size: bigint; total: bigint };

export function totals(rows: Level[]): Row[] {
  let sum = 0n;
  return rows.map((level) => {
    const size = bi(level[1]);
    sum += size;
    return { price: level[0], size, total: sum };
  });
}

export function maxTotal(rows: Row[]): bigint {
  let max = 1n;
  for (const row of rows) if (row.total > max) max = row.total;
  return max;
}

export function depthPct(total: bigint, max: bigint): number {
  let pct = Number((total * 100n) / max);
  if (total > 0n && pct < 1) pct = 1;
  return pct;
}

export function depthStyle(pct: number): CSSProperties {
  return { "--w": pct + "%" } as CSSProperties;
}

export function mineKey(side: "ask" | "bid", price: Scaled): string {
  return side + ":" + bi(price).toString();
}

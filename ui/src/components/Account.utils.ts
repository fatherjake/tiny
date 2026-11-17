import { SCALE, bi, pctShort } from "../lib/scale";
import type { Position, Scaled } from "../types";

export function upnl(
  pos: Position,
  mark: Scaled | null | undefined,
): bigint | null {
  if (mark == null) return null;
  const size = bi(pos.size);
  const abs = size < 0n ? -size : size;
  const notional = (abs * bi(mark)) / SCALE;
  const entry = bi(pos.entry_notional);
  return size > 0n ? notional - entry : entry - notional;
}

export function pnlTone(pnl: bigint | null): string {
  return pnl == null || pnl === 0n ? "" : pnl > 0n ? "up" : "down";
}

export function pnlShare(pnl: bigint | null, margin: bigint | null): string {
  const share = pctShort(pnl, margin);
  return pnl != null && pnl > 0n ? "+" + share : share;
}

export function positionSide(size: bigint): string {
  return size > 0n ? "B" : size < 0n ? "S" : "";
}

export function sortPositions(
  positions: Record<string, Position> | undefined,
): Position[] {
  return Object.values(positions ?? {}).sort((a, b) =>
    String(a.market).localeCompare(String(b.market)),
  );
}

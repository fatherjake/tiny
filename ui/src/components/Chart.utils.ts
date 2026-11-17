import type { Time } from "lightweight-charts";

import { INTERVAL_MS, type Interval } from "../lib/marketQueries";
import type { Series } from "../types";

export type Span = Interval | "tick";

export const SPANS: Span[] = ["1s", "3s", "15s", "1m", "5m", "tick"];
export const WINDOW_BARS = 30;

export type FitTarget = { from: number; to: number } | "content" | null;

export function fitTarget(span: Span, points: Series): FitTarget {
  const candles = points.bars;
  const last =
    candles && candles.length > 0 ? candles[candles.length - 1].time : null;
  if (span !== "tick" && last != null) {
    return {
      from: last - (WINDOW_BARS * INTERVAL_MS[span]) / 1000,
      to: last,
    };
  }
  if ((span === "tick" ? points.ticks : candles)?.length) return "content";
  return null;
}

export function dollars(price: number): string {
  return price.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function axisLabel(span: Span, time: Time): string {
  if (typeof time !== "number") return "";
  if (span === "tick") return String(time);
  const date = new Date(time * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  const clock = pad(date.getHours()) + ":" + pad(date.getMinutes());
  return INTERVAL_MS[span] < 60_000
    ? clock + ":" + pad(date.getSeconds())
    : clock;
}

export function sameRow(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

export type Drawn = { key: string; last: number | null; count: number };

export type Draw =
  | { kind: "reset"; drawn: Drawn }
  | { kind: "append"; from: number; drawn: Drawn };

export function planDraw(
  drawn: Drawn,
  key: string,
  data: { time: number }[],
): Draw {
  const last = data.length ? data[data.length - 1].time : null;
  const reset: Draw = {
    kind: "reset",
    drawn: { key, last, count: data.length },
  };
  if (drawn.key !== key || drawn.last == null || last == null) return reset;
  if (drawn.count > data.length * 2 + 100) return reset;
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < drawn.last) lo = mid + 1;
    else hi = mid;
  }
  if (data[lo].time !== drawn.last) return reset;
  return {
    kind: "append",
    from: lo,
    drawn: { key, last, count: drawn.count + (data.length - 1 - lo) },
  };
}

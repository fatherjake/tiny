import type { Time } from "lightweight-charts";

import { INTERVAL_MS, type Interval } from "../lib/marketQueries";
import type { Series } from "../types";

export type Span = Interval | "tick";

export const SPANS: Span[] = ["1m", "5m", "tick"];
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
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

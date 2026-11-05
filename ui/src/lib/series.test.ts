import { describe, expect, it } from "vitest";

import { applyCandles, rememberPrint, seed } from "./series";

describe("applyCandles", () => {
  it("builds open high low close in time order, at the block time", () => {
    const next = applyCandles({}, [
      { ts: 1_700_000_060_000, open: 2_000_000, high: 4_000_000, low: 1_000_000, close: 3_000_000 },
      { ts: 1_700_000_000_000, open: 1_000_000, high: 1_000_000, low: 1_000_000, close: 1_000_000 },
    ]);
    expect(next.bars).toEqual([
      { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_700_000_060, open: 2, high: 4, low: 1, close: 3 },
    ]);
  });

  it("merges a refresh of the latest minutes into the bars already there", () => {
    const row = (ts: number, close: number) => ({
      ts,
      open: 1_000_000,
      high: close,
      low: 1_000_000,
      close,
    });
    const first = applyCandles({}, [row(1_700_000_000_000, 1_000_000), row(1_700_000_060_000, 2_000_000)]);
    const next = applyCandles(first, [row(1_700_000_060_000, 3_000_000), row(1_700_000_120_000, 4_000_000)]);
    expect(next.bars?.map((bar) => [bar.time, bar.close])).toEqual([
      [1_700_000_000, 1],
      [1_700_000_060, 3],
      [1_700_000_120, 4],
    ]);
    expect(applyCandles(first, [])).toBe(first);
    expect(applyCandles({}, []).bars).toEqual([]);
  });

  it("keeps each second as its own candle", () => {
    const next = applyCandles({}, [
      { ts: 1_700_000_000_000, open: 1_000_000, high: 1_000_000, low: 1_000_000, close: 1_000_000 },
      { ts: 1_700_000_001_000, open: 2_000_000, high: 3_000_000, low: 2_000_000, close: 3_000_000 },
    ]);
    expect(next.bars?.map((bar) => bar.time)).toEqual([1_700_000_000, 1_700_000_001]);
  });
});

describe("tick series", () => {
  it("keeps one point per block when trades share a second", () => {
    const seeded = seed({}, [
      { height: 4, price: 4_000_000 },
      { height: 3, price: 3_000_000 },
      { height: 2, price: 2_500_000 },
      { height: 2, price: 1_000_000 },
    ]);
    expect(seeded.ticks).toEqual([
      { time: 2, value: 2.5 },
      { time: 3, value: 3 },
      { time: 4, value: 4 },
    ]);
    const live = rememberPrint({ BTC: seeded }, "BTC", { height: 4, price: 5_000_000 });
    expect(live.BTC.ticks).toEqual([
      { time: 2, value: 2.5 },
      { time: 3, value: 3 },
      { time: 4, value: 5 },
    ]);
  });

  it("keeps the earliest block as later trades arrive", () => {
    const rows = Array.from({ length: 181 }, (_, index) => ({
      height: 181 - index,
      price: 1_000_000,
    }));
    const seeded = seed({}, rows);
    expect(seeded.ticks?.[0]).toEqual({ time: 1, value: 1 });
    expect(seeded.ticks).toHaveLength(181);
  });
});

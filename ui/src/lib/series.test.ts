import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyCandles, seed, spreadMid, type CandleRow } from "./series";

describe("applyCandles", () => {
  it("builds open high low close in time order, at the block time", () => {
    const next = applyCandles({}, [
      {
        ts: 1_700_000_060_000,
        open: 2_000_000,
        high: 4_000_000,
        low: 1_000_000,
        close: 3_000_000,
      },
      {
        ts: 1_700_000_000_000,
        open: 1_000_000,
        high: 1_000_000,
        low: 1_000_000,
        close: 1_000_000,
      },
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
    const first = applyCandles({}, [
      row(1_700_000_000_000, 1_000_000),
      row(1_700_000_060_000, 2_000_000),
    ]);
    const next = applyCandles(first, [
      row(1_700_000_060_000, 3_000_000),
      row(1_700_000_120_000, 4_000_000),
    ]);
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
      {
        ts: 1_700_000_000_000,
        open: 1_000_000,
        high: 1_000_000,
        low: 1_000_000,
        close: 1_000_000,
      },
      {
        ts: 1_700_000_001_000,
        open: 2_000_000,
        high: 3_000_000,
        low: 2_000_000,
        close: 3_000_000,
      },
    ]);
    expect(next.bars?.map((bar) => bar.time)).toEqual([
      1_700_000_000, 1_700_000_001,
    ]);
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
    const live = seed(seeded, [{ height: 4, price: 5_000_000 }]);
    expect(live.ticks).toEqual([
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

describe("spreadMid", () => {
  it("gives the spread, the mid and the spread as a percent of the mid", () => {
    expect(spreadMid({ best_bid: 99_000_000n, best_ask: "101000000" })).toEqual(
      { spread: 2_000_000n, mid: 100_000_000n, pct: "2.000%" },
    );
    expect(
      spreadMid({ best_bid: 60_000_000_000, best_ask: 60_001_000_000 }),
    ).toEqual({
      spread: 1_000_000n,
      mid: 60_000_500_000n,
      pct: "0.001%",
    });
  });

  it("has no percent when the mid is not positive", () => {
    expect(spreadMid({ best_bid: 0, best_ask: 1 })).toEqual({
      spread: 1n,
      mid: 0n,
      pct: "-",
    });
  });

  it("is empty without both sides of the book", () => {
    const empty = { spread: null, mid: null, pct: "-" };
    expect(spreadMid(null)).toEqual(empty);
    expect(spreadMid(undefined)).toEqual(empty);
    expect(spreadMid({ best_ask: 1n })).toEqual(empty);
    expect(spreadMid({ best_bid: 1n, best_ask: null })).toEqual(empty);
  });
});

describe("seed edges", () => {
  it("skips rows without a price and rows older than the last tick", () => {
    const book = { ticks: [{ time: 5, value: 1 }] };
    const next = seed(book, [
      { height: 7, price: 7_000_000 },
      { height: 6, price: null },
      { height: 3, price: 3_000_000 },
      { height: 6 },
    ]);
    expect(next.ticks).toEqual([
      { time: 5, value: 1 },
      { time: 7, value: 7 },
    ]);
    expect(book.ticks).toEqual([{ time: 5, value: 1 }]);
  });

  it("returns the same book when nothing new arrives", () => {
    const book = { ticks: [{ time: 5, value: 1 }] };
    expect(seed(book, [{ height: 4, price: 1 }, { height: 9 }])).toBe(book);
    expect(seed(book, [{ height: 9, price: 2_000_000 }]).ticks).toEqual([
      { time: 5, value: 1 },
      { time: 9, value: 2 },
    ]);
  });
});

const candle = fc.record({
  ts: fc.integer({ min: 0, max: 600_000 }),
  open: fc.integer({ min: 0, max: 10 ** 12 }),
  high: fc.integer({ min: 0, max: 10 ** 12 }),
  low: fc.integer({ min: 0, max: 10 ** 12 }),
  close: fc.integer({ min: 0, max: 10 ** 12 }),
});

function candleModel(rows: CandleRow[]) {
  const bySecond = new Map<number, CandleRow>();
  for (const row of [...rows].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    bySecond.set(Math.floor(Number(row.ts) / 1000), row);
  }
  return [...bySecond.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, row]) => ({
      time,
      open: Number(row.open) / 1e6,
      high: Number(row.high) / 1e6,
      low: Number(row.low) / 1e6,
      close: Number(row.close) / 1e6,
    }));
}

describe("series properties", () => {
  it("builds one bar per second from the latest row in that second", () => {
    fc.assert(
      fc.property(fc.array(candle, { minLength: 1 }), (rows) => {
        expect(applyCandles({}, rows).bars).toEqual(candleModel(rows));
      }),
    );
  });

  it("gives the same bars when the same rows are applied twice", () => {
    fc.assert(
      fc.property(fc.array(candle), fc.array(candle), (first, second) => {
        const once = applyCandles(applyCandles({}, first), second);
        expect(applyCandles(once, second).bars).toEqual(once.bars);
      }),
    );
  });

  it("keeps bars before a refresh and replaces everything from its first second", () => {
    fc.assert(
      fc.property(
        fc.array(candle, { minLength: 1 }),
        fc.array(candle, { minLength: 1 }),
        (first, second) => {
          const bars = applyCandles(applyCandles({}, first), second).bars ?? [];
          const from = Math.min(
            ...second.map((row) => Math.floor(row.ts / 1000)),
          );
          expect(bars).toEqual([
            ...candleModel(first).filter((bar) => bar.time < from),
            ...candleModel(second),
          ]);
        },
      ),
    );
  });

  it("keeps ticks strictly increasing in block height", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            height: fc.nat(50),
            price: fc.option(fc.integer({ min: 0, max: 10 ** 9 })),
          }),
        ),
        fc.array(fc.record({ height: fc.nat(50), price: fc.nat(10 ** 9) })),
        (first, second) => {
          const ticks = seed(seed({}, first), second).ticks ?? [];
          for (let i = 1; i < ticks.length; i++) {
            expect(ticks[i].time).toBeGreaterThan(ticks[i - 1].time);
          }
        },
      ),
    );
  });

  it("seeds newest-first rows to one tick per height holding the newest price", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ height: fc.nat(50), price: fc.nat(10 ** 9) })),
        (rows) => {
          const newestFirst = [...rows].sort((a, b) => b.height - a.height);
          const byHeight = new Map<number, number>();
          for (const row of [...newestFirst].reverse()) {
            byHeight.set(row.height, row.price / 1e6);
          }
          const expected = [...byHeight.entries()]
            .sort(([a], [b]) => a - b)
            .map(([time, value]) => ({ time, value }));
          expect(seed({}, newestFirst).ticks ?? []).toEqual(expected);
        },
      ),
    );
  });
});

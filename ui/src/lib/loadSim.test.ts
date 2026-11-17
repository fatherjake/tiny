import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { due, fakeBlock, fakeTrade, jiggle, SIM_HASH, walk } from "./loadSim";

const fixed = (value: number) => () => value;

describe("due", () => {
  it("spreads a rate over ticks without losing the fractions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1 }),
        (rate, ticks) => {
          let carry = 0;
          let total = 0;
          for (const ms of ticks) {
            const next = due(rate, ms, carry);
            total += next.count;
            carry = next.carry;
          }
          const expected = (rate * ticks.reduce((a, b) => a + b, 0)) / 1000;
          return Math.abs(total + carry - expected) < 1e-6;
        },
      ),
    );
  });

  it("sends nothing for a zero or negative rate", () => {
    expect(due(0, 1000, 0).count).toBe(0);
    expect(due(-5, 1000, 0).count).toBe(0);
  });
});

describe("fake frames", () => {
  it("keeps the price positive and close to where it was", () => {
    expect(walk(100, fixed(1))).toBeCloseTo(100.02);
    expect(walk(100, fixed(0))).toBeCloseTo(99.98);
    expect(walk(0.5, fixed(0))).toBe(1);
  });

  it("drifts back towards where it started instead of wandering off", () => {
    let price = 100;
    for (let i = 0; i < 20_000; i++) price = walk(price, fixed(0.5), 120);
    expect(price).toBeGreaterThan(110);
  });

  it("makes trades with seqs that never clash with the chain's", () => {
    const trade = fakeTrade(3, "BTC-PERP", 50_000.5, 9, fixed(0.25));
    expect(trade).toMatchObject({
      type: "trade",
      market: "BTC-PERP",
      side: "buy",
      price: 50_000_500_000,
      height: 9,
      size: 125_000,
    });
    expect(trade.seq).toBeGreaterThan(1e12);
  });

  it("only touches book sizes, never prices", () => {
    const book = {
      bids: [[100, 5]] as [number, number][],
      asks: [[101, 7]] as [number, number][],
    };
    const next = jiggle(book, "BTC-PERP", fixed(0.1));
    expect(next.bids?.[0][0]).toBe(100);
    expect(next.asks?.[0][0]).toBe(101);
    expect(next.bids?.[0][1]).toBe(3);
    expect(next.type).toBe("book");
  });

  it("marks fake blocks so they can be cleared out afterwards", () => {
    const block = fakeBlock(12, 500, 7);
    expect(block).toMatchObject({ height: 500, view: 7 });
    expect(block.hash.startsWith(SIM_HASH)).toBe(true);
    expect(block.txs).toHaveLength(20);
  });
});

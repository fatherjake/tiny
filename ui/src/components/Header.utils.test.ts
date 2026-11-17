import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { MarketInfo } from "../types";
import { annual, names, sinceLabel } from "./Header.utils";

const HOUR = 3_600_000;

const market = (over: Partial<MarketInfo> = {}): MarketInfo => ({
  name: "BTC-USD",
  tick_size: 1,
  lot_size: 1,
  max_leverage: 10,
  maintenance_margin_bps: 500,
  oracle_price: 100_000_000,
  mark_price: null,
  funding_index: 1_000_000,
  funding_ts: HOUR,
  funding_base: { height: 1, market: "BTC-USD", index: 0, rate: 0, ts: 0 },
  ...over,
});

describe("names", () => {
  it("lists market names in order", () => {
    expect(
      names([market({ name: "ETH-USD" }), market({ name: "BTC-USD" })]),
    ).toEqual(["ETH-USD", "BTC-USD"]);
  });
});

describe("annual", () => {
  it("annualises the funding paid since the base", () => {
    expect(annual(market())).toBe("8760.0000%");
  });

  it("keeps the sign of negative funding", () => {
    expect(
      annual(market({ funding_index: "-500000", funding_ts: 2 * HOUR })),
    ).toBe("-2190.0000%");
  });

  it.each([
    ["no market", null],
    ["no base", market({ funding_base: null })],
    ["no funding time", market({ funding_ts: null })],
    ["no funding index", market({ funding_index: null })],
    ["no oracle", market({ oracle_price: null })],
    ["zero oracle", market({ oracle_price: 0 })],
    ["no elapsed time", market({ funding_ts: 0 })],
    ["time going backwards", market({ funding_ts: -HOUR })],
  ])("shows a dash with %s", (_, input) => {
    expect(annual(input)).toBe("-");
  });

  it("is unchanged when paid funding and elapsed time scale together", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        (paid, elapsed, k, oracle) =>
          annual(
            market({
              funding_index: paid,
              funding_ts: elapsed,
              oracle_price: oracle,
            }),
          ) ===
          annual(
            market({
              funding_index: BigInt(paid) * BigInt(k),
              funding_ts: elapsed * k,
              oracle_price: oracle,
            }),
          ),
      ),
    );
  });

  it("is negative exactly when the paid share rounds below zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000 }),
        (paid, elapsed) => {
          const text = annual(
            market({ funding_index: paid, funding_ts: elapsed }),
          );
          const millionths =
            (BigInt(paid) * 31_536_000_000n * 1_000_000n) /
            (100_000_000n * BigInt(elapsed));
          return text.endsWith("%") && text.startsWith("-") === millionths < 0n;
        },
      ),
    );
  });
});

describe("sinceLabel", () => {
  it("shows seconds with one decimal", () => {
    expect(sinceLabel(1000, 3500)).toBe("2.5s");
  });

  it("clamps clock skew to zero", () => {
    expect(sinceLabel(5000, 1000)).toBe("0.0s");
  });

  it("shows a dash before the first block", () => {
    expect(sinceLabel(null, 5000)).toBe("-");
    expect(sinceLabel(undefined, 5000)).toBe("-");
  });

  it("is never negative and never decreases as time passes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (at, now, later) => {
          const a = parseFloat(sinceLabel(at, now));
          const b = parseFloat(sinceLabel(at, now + later));
          return a >= 0 && a <= b;
        },
      ),
    );
  });
});

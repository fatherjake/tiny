import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Level } from "../types";
import {
  type Row,
  depthPct,
  depthStyle,
  maxTotal,
  mineKey,
  totals,
} from "./Book.utils";

const row = (total: bigint): Row => ({ price: 1, size: total, total });

describe("totals", () => {
  it("accumulates sizes down the book", () => {
    expect(
      totals([
        [100, 2_000_000],
        ["99", "3000000"],
        [98n, 500_000n],
      ]),
    ).toEqual([
      { price: 100, size: 2_000_000n, total: 2_000_000n },
      { price: "99", size: 3_000_000n, total: 5_000_000n },
      { price: 98n, size: 500_000n, total: 5_500_000n },
    ]);
  });

  it("keeps length, ends at the sum and never decreases for non-negative sizes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.bigInt({ min: 1n, max: 10n ** 12n }),
            fc.bigInt({ min: 0n, max: 10n ** 12n }),
          ),
        ),
        (levels: Level[]) => {
          const rows = totals(levels);
          const sum = levels.reduce((acc, level) => acc + BigInt(level[1]), 0n);
          return (
            rows.length === levels.length &&
            (rows.length === 0 || rows[rows.length - 1].total === sum) &&
            rows.every((r, i) => i === 0 || rows[i - 1].total <= r.total)
          );
        },
      ),
    );
  });
});

describe("maxTotal", () => {
  it("returns the largest total", () => {
    expect(maxTotal([row(5n), row(9n), row(3n)])).toBe(9n);
  });

  it("never goes below 1", () => {
    expect(maxTotal([])).toBe(1n);
    expect(maxTotal([row(0n)])).toBe(1n);
  });

  it("agrees with the max of 1 and every total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n })),
        (values) => {
          const expected = values.reduce((a, b) => (b > a ? b : a), 1n);
          return maxTotal(values.map(row)) === expected;
        },
      ),
    );
  });
});

describe("depthPct", () => {
  it("returns the floored percentage of the max", () => {
    expect(depthPct(50n, 100n)).toBe(50);
    expect(depthPct(2n, 3n)).toBe(66);
    expect(depthPct(100n, 100n)).toBe(100);
  });

  it("shows at least 1 for any non-empty level", () => {
    expect(depthPct(1n, 1000n)).toBe(1);
    expect(depthPct(0n, 1000n)).toBe(0);
  });

  it("stays in [0, 100], is monotonic and is at least 1 when non-empty", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (max, x, y) => {
          const a = x % (max + 1n);
          const b = y % (max + 1n);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const pa = depthPct(lo, max);
          const pb = depthPct(hi, max);
          return pa >= 0 && pb <= 100 && pa <= pb && (lo === 0n || pa >= 1);
        },
      ),
    );
  });
});

describe("depthStyle", () => {
  it("sets the width variable as a percentage", () => {
    expect(depthStyle(42)).toEqual({ "--w": "42%" });
  });
});

describe("mineKey", () => {
  it("joins side and integer price", () => {
    expect(mineKey("bid", "1500000")).toBe("bid:1500000");
    expect(mineKey("ask", 1_500_000)).toBe("ask:1500000");
  });

  it("is the same for number, string and bigint prices", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ask" as const, "bid" as const),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (side, price) => {
          const key = mineKey(side, BigInt(price));
          return (
            key === side + ":" + price &&
            mineKey(side, price) === key &&
            mineKey(side, String(price)) === key
          );
        },
      ),
    );
  });
});

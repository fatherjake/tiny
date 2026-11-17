import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { positionValue } from "../lib/orders";
import type { Position } from "../types";
import {
  pnlShare,
  pnlTone,
  positionSide,
  sortPositions,
  upnl,
} from "./Account.utils";

const pos = (market: string, size: bigint, entry: bigint): Position => ({
  market,
  size,
  entry_notional: entry,
});

describe("upnl", () => {
  it("gains on a long when the mark rises", () => {
    expect(upnl(pos("BTC", 2_000_000n, 100_000_000n), 60_000_000n)).toBe(
      20_000_000n,
    );
  });

  it("loses on a short when the mark rises", () => {
    expect(upnl(pos("BTC", -2_000_000n, 100_000_000n), "60000000")).toBe(
      -20_000_000n,
    );
  });

  it("returns null without a mark", () => {
    expect(upnl(pos("BTC", 1_000_000n, 1n), null)).toBe(null);
    expect(upnl(pos("BTC", 1_000_000n, 1n), undefined)).toBe(null);
    expect(upnl(pos("BTC", 1_000_000n, 1n), 0)).toBe(-1n);
  });

  it("is zero for a flat position", () => {
    expect(upnl(pos("BTC", 0n, 0n), 5_000_000n)).toBe(0n);
  });

  it("matches position value minus entry for longs and negates for shorts", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (size, entry, mark) => {
          const long = upnl(pos("X", size, entry), mark);
          const short = upnl(pos("X", -size, entry), mark);
          return (
            long === positionValue(size, mark)! - entry && short === -long!
          );
        },
      ),
    );
  });

  it("is monotonic in the mark for longs", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (size, entry, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return (
            upnl(pos("X", size, entry), lo)! <= upnl(pos("X", size, entry), hi)!
          );
        },
      ),
    );
  });
});

describe("pnlTone", () => {
  it("maps the sign to a tone", () => {
    expect(pnlTone(5n)).toBe("up");
    expect(pnlTone(-5n)).toBe("down");
    expect(pnlTone(0n)).toBe("");
    expect(pnlTone(null)).toBe("");
  });

  it("agrees with the sign of any pnl", () => {
    fc.assert(
      fc.property(fc.bigInt(), (pnl) => {
        const tone = pnlTone(pnl);
        return pnl > 0n
          ? tone === "up"
          : pnl < 0n
            ? tone === "down"
            : tone === "";
      }),
    );
  });
});

describe("pnlShare", () => {
  it("prefixes a positive share with a plus", () => {
    expect(pnlShare(1_000_000n, 10_000_000n)).toBe("+10.00%");
  });

  it("keeps the minus on a negative share", () => {
    expect(pnlShare(-1_000_000n, 10_000_000n)).toBe("-10.00%");
  });

  it("shows zero without a sign", () => {
    expect(pnlShare(0n, 10_000_000n)).toBe("0.00%");
  });

  it("shows a dash without pnl or margin", () => {
    expect(pnlShare(null, 10_000_000n)).toBe("-");
    expect(pnlShare(-5n, null)).toBe("-");
    expect(pnlShare(-5n, 0n)).toBe("-");
  });

  it.fails("shows a plain dash for a positive pnl with no margin", () => {
    expect(pnlShare(1n, 0n)).toBe("-");
  });

  it("starts with + exactly when the share is positive", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (pnl, margin) => {
          const text = pnlShare(pnl, margin);
          return (
            text.endsWith("%") &&
            text.startsWith("+") === pnl > 0n &&
            text.startsWith("-") === (pnl * 10_000n) / margin < 0n
          );
        },
      ),
    );
  });
});

describe("positionSide", () => {
  it("labels longs, shorts and flat", () => {
    expect(positionSide(3n)).toBe("B");
    expect(positionSide(-3n)).toBe("S");
    expect(positionSide(0n)).toBe("");
  });
});

describe("sortPositions", () => {
  it("orders positions by market name", () => {
    const sorted = sortPositions({
      e: pos("ETH-USD", 1n, 1n),
      b: pos("BTC-USD", 2n, 2n),
      s: pos("SOL-USD", 3n, 3n),
    });
    expect(sorted.map((p) => p.market)).toEqual([
      "BTC-USD",
      "ETH-USD",
      "SOL-USD",
    ]);
  });

  it("returns no rows for a missing map", () => {
    expect(sortPositions(undefined)).toEqual([]);
    expect(sortPositions({ a: pos("A", 1n, 1n) })).toHaveLength(1);
  });

  it("returns a sorted permutation of the input", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string({ minLength: 1 })),
        (names) => {
          const map = Object.fromEntries(
            Object.entries(names).map(([key, name]) => [
              key,
              pos(name, 1n, 1n),
            ]),
          );
          const sorted = sortPositions(map).map((p) => p.market);
          const ordered = sorted.every(
            (name, i) => i === 0 || sorted[i - 1].localeCompare(name) <= 0,
          );
          const same =
            [...sorted].sort().join("\u0000") ===
            Object.values(names).sort().join("\u0000");
          return ordered && same;
        },
      ),
    );
  });
});

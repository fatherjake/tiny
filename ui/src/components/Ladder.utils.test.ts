import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OpenOrder, Trade } from "../types";
import { latest, mineKeys } from "./Ladder.utils";

const trade = (seq: number): Trade => ({
  seq,
  height: seq,
  timestamp_ms: 0,
  market: "BTC-USD",
  side: "buy",
  price: 1,
  size: 1,
});

const order = (
  market: string,
  side: "buy" | "sell",
  price: OpenOrder["price"],
): OpenOrder => ({ id: 1, market, side, price, size: 1 });

describe("latest", () => {
  it("keeps the first 40 prints", () => {
    const rows = Array.from({ length: 50 }, (_, i) => trade(i));
    const kept = latest(rows);
    expect(kept).toHaveLength(40);
    expect(kept[0].seq).toBe(0);
    expect(kept[39].seq).toBe(39);
  });

  it("is a prefix of at most 40 rows", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 100 }), (seqs) => {
        const rows = seqs.map(trade);
        const kept = latest(rows);
        return (
          kept.length === Math.min(rows.length, 40) &&
          kept.every((r, i) => r === rows[i])
        );
      }),
    );
  });
});

describe("mineKeys", () => {
  it("keys the market's orders by book side and price", () => {
    expect(
      mineKeys(
        [
          order("BTC-USD", "buy", 100),
          order("BTC-USD", "sell", "101"),
          order("ETH-USD", "buy", 5n),
          order("BTC-USD", "buy", 100n),
        ],
        "BTC-USD",
      ),
    ).toEqual(new Set(["bid:100", "ask:101"]));
  });

  it("contains a key for every order in the market and none from others", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom("A", "B"),
            fc.constantFrom("buy" as const, "sell" as const),
            fc.nat(),
          ),
        ),
        (specs) => {
          const keys = mineKeys(
            specs.map(([m, side, price]) => order(m, side, price)),
            "A",
          );
          const expected = new Set(
            specs
              .filter(([m]) => m === "A")
              .map(
                ([, side, price]) => (side === "buy" ? "bid:" : "ask:") + price,
              ),
          );
          return (
            keys.size === expected.size &&
            [...expected].every((k) => keys.has(k))
          );
        },
      ),
    );
  });
});

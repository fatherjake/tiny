import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OpenOrder } from "../types";
import { mineKeys } from "./Ladder.utils";

const order = (
  market: string,
  side: "buy" | "sell",
  price: OpenOrder["price"],
): OpenOrder => ({ id: 1, market, side, price, size: 1 });

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

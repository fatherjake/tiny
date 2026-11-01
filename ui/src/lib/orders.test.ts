import { describe, expect, it } from "vitest";

import { marketPrice } from "./orders";

describe("marketPrice", () => {
  it("caps a buy 1% above the ask and a sell 1% below the bid", () => {
    const book = { best_bid: 10_000_000_000n, best_ask: 10_100_000_000n };
    expect(marketPrice("buy", book)).toBe(10_201_000_000n);
    expect(marketPrice("sell", book)).toBe(9_900_000_000n);
  });

  it("returns null without a touch, or when the sell cap rounds to zero", () => {
    expect(marketPrice("buy", { best_bid: 5n })).toBe(null);
    expect(marketPrice("sell", null)).toBe(null);
    expect(marketPrice("sell", { best_bid: 1n })).toBe(null);
  });
});

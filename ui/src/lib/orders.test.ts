import { describe, expect, it } from "vitest";

import { closeOrder, currentPrice, marketPrice, outcome } from "./orders";

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

describe("currentPrice", () => {
  const market = {
    name: "BTC",
    tick_size: 500_000n,
    lot_size: 1n,
    max_leverage: 10,
    maintenance_margin_bps: 500,
    oracle_price: 99_000_000n,
    mark_price: 100_300_000n,
    funding_index: null,
    funding_ts: null,
    funding_base: null,
  };

  it("uses the mark snapped down to the tick, falling back to the oracle", () => {
    expect(currentPrice(market)).toBe(100_000_000n);
    expect(currentPrice({ ...market, mark_price: null })).toBe(99_000_000n);
  });

  it("returns null without a market or a price", () => {
    expect(currentPrice(null)).toBe(null);
    expect(currentPrice({ ...market, mark_price: null, oracle_price: null })).toBe(null);
  });
});

describe("outcome", () => {
  it("names the status and explains a rejection", () => {
    expect(outcome({ order_id: 7, status: "placed", reason: "" })).toBe("order 7 placed");
    expect(outcome({ order_id: 7, status: "rejected", reason: "margin" })).toBe(
      "order 7 rejected: not enough margin",
    );
    expect(outcome({ order_id: 7, status: "partial", reason: "unfilled" })).toBe(
      "order 7 partial: unfilled",
    );
  });
});

describe("closeOrder", () => {
  const book = { best_bid: 10_000_000_000n, best_ask: 10_100_000_000n };

  it("sells a long and buys back a short, for the whole size", () => {
    expect(closeOrder({ market: "BTC-PERP", size: 2_000_000n, entry_notional: 0n }, book)).toEqual({
      side: "sell",
      size: 2_000_000n,
      price: 9_900_000_000n,
    });
    expect(closeOrder({ market: "BTC-PERP", size: -500_000n, entry_notional: 0n }, book)).toEqual({
      side: "buy",
      size: 500_000n,
      price: 10_201_000_000n,
    });
  });

  it("returns null for a flat position or no quote", () => {
    expect(closeOrder({ market: "BTC-PERP", size: 0n, entry_notional: 0n }, book)).toBe(null);
    expect(closeOrder({ market: "BTC-PERP", size: 1n, entry_notional: 0n }, null)).toBe(null);
  });
});

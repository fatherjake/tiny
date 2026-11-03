import { describe, expect, it } from "vitest";

import {
  availableMargin,
  closeOrder,
  currentPrice,
  marketPrice,
  midPrice,
  outcome,
  sizeFromUsd,
} from "./orders";

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

describe("midPrice", () => {
  const market = { tick_size: 500_000n } as Parameters<typeof midPrice>[0];

  it("snaps the mid down to the tick", () => {
    expect(midPrice(market, { best_bid: 100_000_000n, best_ask: 101_400_000n })).toBe(100_500_000n);
  });

  it("needs both sides", () => {
    expect(midPrice(market, { best_bid: 100_000_000n })).toBe(null);
  });
});

describe("sizeFromUsd", () => {
  it("rounds the base size down to the lot", () => {
    // $10 at $2,254.20 is 0.004436... ETH, so 0.0044 on a 0.0001 lot.
    expect(sizeFromUsd(10_000_000n, 2_254_200_000n, 100n)).toBe(4_400n);
    expect(sizeFromUsd(10_000_000n, 0n, 100n)).toBe(0n);
  });
});

describe("availableMargin", () => {
  const markets = [
    {
      name: "BTC-PERP",
      tick_size: 1n,
      lot_size: 1n,
      max_leverage: 10,
      maintenance_margin_bps: 500,
      oracle_price: 100_000_000n,
      mark_price: 100_000_000n,
      funding_index: null,
      funding_ts: null,
      funding_base: null,
    },
  ];
  const account = {
    trader: "t",
    collateral: 1_000_000_000n,
    nonce: 0,
    account_value: 1_000_000_000n,
    positions: { "BTC-PERP": { market: "BTC-PERP", size: -2_000_000n, entry_notional: 0n } },
  };

  it("takes position and resting-order initial margin off the account value", () => {
    const order = { id: 1, market: "BTC-PERP", side: "buy" as const, price: 50_000_000n, size: 4_000_000n };
    // $1,000 less $20 for the $200 short and $20 for the $200 bid, both at 10x.
    expect(availableMargin(account, markets, [order])).toBe(960_000_000n);
  });

  it("is zero without an account", () => {
    expect(availableMargin(null, markets, [])).toBe(0n);
  });
});

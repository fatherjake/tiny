import { describe, expect, it } from "vitest";

import {
  afterFill,
  availableMargin,
  bpsPct,
  closeOrder,
  currentPrice,
  liquidationPrice,
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
    maker_fee_bps: 2,
    taker_fee_bps: 5,
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
    maker_fee_bps: 2,
    taker_fee_bps: 5,
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

describe("afterFill", () => {
  const flat = { collateral: 1_000_000_000n, size: 0n, entry: 0n };

  it("opens, charges the fee, and adds to the entry", () => {
    // Buy 0.1 at $50,000: $5,000 notional, $2.50 taker fee at 5 bps.
    expect(afterFill(flat, 100_000n, 50_000_000_000n, 5n)).toEqual({
      collateral: 997_500_000n,
      size: 100_000n,
      entry: 5_000_000_000n,
    });
  });

  it("realises pnl on a partial close and keeps the rest of the entry", () => {
    const long = { collateral: 1_000_000_000n, size: 200_000n, entry: 10_000_000_000n };
    // Sell half at $51,000, no fee: $100 profit, half the entry left.
    expect(afterFill(long, -100_000n, 51_000_000_000n, 0n)).toEqual({
      collateral: 1_100_000_000n,
      size: 100_000n,
      entry: 5_000_000_000n,
    });
  });

  it("flips through flat and enters the new side at the fill", () => {
    const long = { collateral: 1_000_000_000n, size: 100_000n, entry: 5_000_000_000n };
    expect(afterFill(long, -300_000n, 50_000_000_000n, 0n)).toEqual({
      collateral: 1_000_000_000n,
      size: -200_000n,
      entry: 10_000_000_000n,
    });
  });
});

describe("liquidationPrice", () => {
  it("solves value = maintenance for a long and a short", () => {
    // 0.2 BTC long, $10,000 entry, $1,000 collateral, 3% maintenance:
    // p = (10,000 - 1,000) / (0.2 * 0.97) = $46,391.75...
    const long = { collateral: 1_000_000_000n, size: 200_000n, entry: 10_000_000_000n };
    expect(liquidationPrice(long, 300n)).toBe(46_391_752_577n);
    // Short: p = (1,000 + 10,000) / (0.2 * 1.03) = $53,398.05...
    const short = { ...long, size: -200_000n };
    expect(liquidationPrice(short, 300n)).toBe(53_398_058_252n);
  });

  it("is null when flat or when the long can never fall far enough", () => {
    expect(liquidationPrice({ collateral: 1n, size: 0n, entry: 0n }, 300n)).toBe(null);
    const covered = { collateral: 20_000_000_000n, size: 200_000n, entry: 10_000_000_000n };
    expect(liquidationPrice(covered, 300n)).toBe(null);
  });
});

describe("bpsPct", () => {
  it("shows bps as a percentage to four places", () => {
    expect(bpsPct(5)).toBe("0.0500%");
    expect(bpsPct(2)).toBe("0.0200%");
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Depth, OrderDraft } from "../types";
import {
  afterFill,
  availableMargin,
  bpsPct,
  closeOrder,
  currentPrice,
  entryPrice,
  fillSide,
  gridNote,
  positionRisk,
  positionValue,
  liquidationPrice,
  marketPrice,
  midPrice,
  outcome,
  previewOrder,
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
    expect(
      currentPrice({ ...market, mark_price: null, oracle_price: null }),
    ).toBe(null);
  });
});

describe("outcome", () => {
  it("names the status and explains a rejection", () => {
    expect(outcome({ order_id: 7, status: "placed", reason: "" })).toBe(
      "order 7 placed",
    );
    expect(outcome({ order_id: 7, status: "rejected", reason: "margin" })).toBe(
      "order 7 rejected: not enough margin",
    );
    expect(
      outcome({ order_id: 7, status: "partial", reason: "unfilled" }),
    ).toBe("order 7 partial: unfilled");
  });
});

describe("closeOrder", () => {
  const book = { best_bid: 10_000_000_000n, best_ask: 10_100_000_000n };

  it("sells a long and buys back a short, for the whole size", () => {
    expect(
      closeOrder(
        { market: "BTC-PERP", size: 2_000_000n, entry_notional: 0n },
        book,
      ),
    ).toEqual({
      side: "sell",
      size: 2_000_000n,
      price: 9_900_000_000n,
    });
    expect(
      closeOrder(
        { market: "BTC-PERP", size: -500_000n, entry_notional: 0n },
        book,
      ),
    ).toEqual({
      side: "buy",
      size: 500_000n,
      price: 10_201_000_000n,
    });
  });

  it("returns null for a flat position or no quote", () => {
    expect(
      closeOrder({ market: "BTC-PERP", size: 0n, entry_notional: 0n }, book),
    ).toBe(null);
    expect(
      closeOrder({ market: "BTC-PERP", size: 1n, entry_notional: 0n }, null),
    ).toBe(null);
  });
});

describe("midPrice", () => {
  const market = { tick_size: 500_000n } as Parameters<typeof midPrice>[0];

  it("snaps the mid down to the tick", () => {
    expect(
      midPrice(market, { best_bid: 100_000_000n, best_ask: 101_400_000n }),
    ).toBe(100_500_000n);
  });

  it("needs both sides", () => {
    expect(midPrice(market, { best_bid: 100_000_000n })).toBe(null);
  });
});

describe("sizeFromUsd", () => {
  it("rounds the base size down to the lot", () => {
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
    positions: {
      "BTC-PERP": { market: "BTC-PERP", size: -2_000_000n, entry_notional: 0n },
    },
  };

  it("takes position and resting-order initial margin off the account value", () => {
    const order = {
      id: 1,
      market: "BTC-PERP",
      side: "buy" as const,
      price: 50_000_000n,
      size: 4_000_000n,
    };
    expect(availableMargin(account, markets, [order])).toBe(960_000_000n);
  });

  it("is zero without an account", () => {
    expect(availableMargin(null, markets, [])).toBe(0n);
  });
});

describe("previewOrder", () => {
  const market = {
    name: "BTC-PERP",
    tick_size: 1n,
    lot_size: 1n,
    max_leverage: 10,
    maintenance_margin_bps: 300,
    oracle_price: 100_000_000n,
    mark_price: 100_000_000n,
    funding_index: null,
    funding_ts: null,
    funding_base: null,
    maker_fee_bps: 2,
    taker_fee_bps: 5,
  };

  it("reserves market-order margin at the submitted buy cap, not the touch", () => {
    const preview = previewOrder(
      { side: "buy", type: "market", usd: "100", price: "", reduceOnly: false },
      market,
      [market],
      { best_bid: 99_000_000n, best_ask: 100_000_000n },
      {
        trader: "t",
        collateral: 10_000_000n,
        nonce: 0,
        account_value: 10_000_000n,
      },
      [],
    );
    expect(preview.notional).toBe(100_000_000n);
    expect(preview.requiredMargin).toBe(10_100_000n);
    expect(preview.maxUsd).toBe(99_009_900n);
    expect(preview.problem).toBe("margin");
  });
});

describe("afterFill", () => {
  const flat = { collateral: 1_000_000_000n, size: 0n, entry: 0n };

  it("opens, charges the fee, and adds to the entry", () => {
    expect(afterFill(flat, 100_000n, 50_000_000_000n, 5n)).toEqual({
      collateral: 997_500_000n,
      size: 100_000n,
      entry: 5_000_000_000n,
    });
  });

  it("realises pnl on a partial close and keeps the rest of the entry", () => {
    const long = {
      collateral: 1_000_000_000n,
      size: 200_000n,
      entry: 10_000_000_000n,
    };
    expect(afterFill(long, -100_000n, 51_000_000_000n, 0n)).toEqual({
      collateral: 1_100_000_000n,
      size: 100_000n,
      entry: 5_000_000_000n,
    });
  });

  it("flips through flat and enters the new side at the fill", () => {
    const long = {
      collateral: 1_000_000_000n,
      size: 100_000n,
      entry: 5_000_000_000n,
    };
    expect(afterFill(long, -300_000n, 50_000_000_000n, 0n)).toEqual({
      collateral: 1_000_000_000n,
      size: -200_000n,
      entry: 10_000_000_000n,
    });
  });
});

describe("liquidationPrice", () => {
  it("solves value = maintenance for a long and a short", () => {
    const long = {
      collateral: 1_000_000_000n,
      size: 200_000n,
      entry: 10_000_000_000n,
    };
    expect(liquidationPrice(long, 300n)).toBe(46_391_752_577n);
    const short = { ...long, size: -200_000n };
    expect(liquidationPrice(short, 300n)).toBe(53_398_058_252n);
  });

  it("is null when flat or when the long can never fall far enough", () => {
    expect(
      liquidationPrice({ collateral: 1n, size: 0n, entry: 0n }, 300n),
    ).toBe(null);
    const covered = {
      collateral: 20_000_000_000n,
      size: 200_000n,
      entry: 10_000_000_000n,
    };
    expect(liquidationPrice(covered, 300n)).toBe(null);
  });
});

describe("bpsPct", () => {
  it("shows bps as a percentage to four places", () => {
    expect(bpsPct(5)).toBe("0.0500%");
    expect(bpsPct(2)).toBe("0.0200%");
  });
});

describe("fillSide", () => {
  const fill = { taker: "aa", maker: "bb", side: "sell" as const };

  it("is the stored side for the taker", () => {
    expect(fillSide(fill, "aa")).toBe("sell");
  });

  it("is the other side for the maker whose resting order was hit", () => {
    expect(fillSide(fill, "bb")).toBe("buy");
    expect(fillSide({ ...fill, side: "buy" }, "bb")).toBe("sell");
  });
});

describe("positionValue", () => {
  it("is the size at the mark, the same for a long and a short", () => {
    expect(positionValue(500_000n, 50_000_000_000)).toBe(25_000_000_000n);
    expect(positionValue(-500_000n, 50_000_000_000)).toBe(25_000_000_000n);
  });

  it("is unknown without a mark", () => {
    expect(positionValue(500_000n, null)).toBeNull();
  });
});

describe("positionRisk", () => {
  const market = {
    name: "BTC-PERP",
    tick_size: 1,
    lot_size: 1,
    max_leverage: 10,
    maintenance_margin_bps: 300,
    oracle_price: null,
    mark_price: null,
    funding_index: null,
    funding_ts: null,
    funding_base: null,
  };

  it("gives the liquidation price, the gap to it from the mark, and the initial margin", () => {
    expect(
      positionRisk(
        200_000n,
        10_000_000_000n,
        1_000_000_000n,
        50_000_000_000,
        market,
      ),
    ).toEqual({
      liquidation: 46_391_752_577n,
      toLiquidation: 3_608_247_423n,
      margin: 1_000_000_000n,
    });
  });

  it("has no gap without a mark", () => {
    expect(
      positionRisk(200_000n, 10_000_000_000n, 1_000_000_000n, null, market)
        .toLiquidation,
    ).toBeNull();
  });
});

const perp = {
  name: "BTC-PERP",
  tick_size: 1n,
  lot_size: 1n,
  max_leverage: 10,
  maintenance_margin_bps: 300,
  oracle_price: 100_000_000n,
  mark_price: 100_000_000n,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
  maker_fee_bps: 2,
  taker_fee_bps: 5,
};

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  side: "buy",
  type: "limit",
  usd: "1000",
  price: "100",
  reduceOnly: false,
  ...over,
});

const funded = {
  trader: "t",
  collateral: 1_000_000_000n,
  nonce: 0,
  account_value: 1_000_000_000n,
};

describe("previewOrder at a zero limit price", () => {
  it("offers no max and flags the size instead of throwing", () => {
    const preview = previewOrder(
      draft({ price: "0", usd: "6" }),
      perp,
      [perp],
      null,
      funded,
      [],
    );
    expect(preview.maxUsd).toBe(null);
    expect(preview.size).toBe(0n);
    expect(preview.problem).toBe("size is below one lot");
  });

  it("never throws for any typed price or size", () => {
    const typed = fc.stringMatching(/^[0-9]{0,6}(\.[0-9]{0,7})?$/);
    fc.assert(
      fc.property(
        typed,
        typed,
        fc.constantFrom("buy", "sell"),
        (price, usd, side) => {
          const preview = previewOrder(
            draft({ price, usd, side }),
            perp,
            [perp],
            null,
            funded,
            [],
          );
          expect(preview.maxUsd == null || preview.maxUsd >= 0n).toBe(true);
        },
      ),
    );
  });
});

describe("marketPrice edges", () => {
  it("returns null for a missing or non-positive touch", () => {
    expect(marketPrice("buy", { best_bid: 5n, best_ask: null })).toBe(null);
    expect(marketPrice("buy", { best_ask: 0n })).toBe(null);
    expect(marketPrice("sell", { best_bid: "-5" })).toBe(null);
    expect(marketPrice("buy", { best_ask: "100" })).toBe(101n);
  });
});

describe("gridNote", () => {
  const market = { ...perp, tick_size: 500_000n, lot_size: 1_000n };

  it("flags a size off the lot before a price off the tick", () => {
    expect(gridNote(market, 1_500n, 100_250_000n, "limit")).toBe("off lot");
    expect(gridNote(market, 2_000n, 100_250_000n, "limit")).toBe("off tick");
    expect(gridNote(market, null, 100_250_000n, "limit")).toBe("off tick");
  });

  it("passes an order on the grid, a market order's price, and a zero grid", () => {
    expect(gridNote(market, 2_000n, 100_500_000n, "limit")).toBe("");
    expect(gridNote(market, 2_000n, 100_250_000n, "market")).toBe("");
    expect(
      gridNote({ ...market, tick_size: 0n, lot_size: 0n }, 7n, 7n, "limit"),
    ).toBe("");
    expect(gridNote(null, 1_500n, 100_250_000n, "limit")).toBe("");
    expect(gridNote(market, 2_000n, null, "limit")).toBe("");
  });
});

describe("currentPrice and midPrice edges", () => {
  it("does not snap without a tick, and is null once snapped to zero", () => {
    expect(currentPrice({ ...perp, tick_size: 0n, mark_price: 123n })).toBe(
      123n,
    );
    expect(
      currentPrice({ ...perp, tick_size: 500_000n, mark_price: 300_000n }),
    ).toBe(null);
    expect(
      midPrice({ ...perp, tick_size: 0n }, { best_bid: 1n, best_ask: 4n }),
    ).toBe(2n);
    expect(
      midPrice({ ...perp, tick_size: 5n }, { best_bid: 1n, best_ask: 2n }),
    ).toBe(null);
    expect(midPrice(null, { best_bid: 1n, best_ask: 4n })).toBe(null);
    expect(midPrice(perp, null)).toBe(null);
  });

  it("keeps an unrounded size without a lot", () => {
    expect(sizeFromUsd(10_000_000n, 3_000_000n, 0n)).toBe(3_333_333n);
  });
});

describe("availableMargin edges", () => {
  it("prices positions at the oracle, skips unpriced ones, and uses 1x when leverage is unset", () => {
    const markets = [
      {
        ...perp,
        name: "A",
        max_leverage: 0,
        mark_price: null,
        oracle_price: 50_000_000n,
      },
      {
        ...perp,
        name: "B",
        max_leverage: 5,
        mark_price: null,
        oracle_price: null,
      },
    ];
    const account = {
      ...funded,
      positions: {
        A: { market: "A", size: 4_000_000n, entry_notional: 0n },
        B: { market: "B", size: 1_000_000n, entry_notional: 0n },
        C: { market: "C", size: 1_000_000n, entry_notional: 0n },
      },
    };
    const order = {
      id: 1,
      market: "Z",
      side: "buy" as const,
      price: 100_000_000n,
      size: 2_000_000n,
    };
    expect(availableMargin(account, markets, [order])).toBe(600_000_000n);
  });

  it("floors at zero and reads a missing account value as zero", () => {
    const order = {
      id: 1,
      market: "BTC-PERP",
      side: "buy" as const,
      price: 100_000_000n,
      size: 30_000_000n,
    };
    expect(availableMargin(funded, [perp], [order])).toBe(700_000_000n);
    expect(
      availableMargin(
        { ...funded, account_value: 100_000_000n },
        [perp],
        [order],
      ),
    ).toBe(0n);
    expect(
      availableMargin({ trader: "t", collateral: 5n, nonce: 0 }, [perp], []),
    ).toBe(0n);
  });
});

describe("previewOrder cases", () => {
  it("sizes a limit buy at its own price and charges the maker fee in the liquidation", () => {
    expect(previewOrder(draft(), perp, [perp], null, funded, [])).toEqual({
      available: 1_000_000_000n,
      held: 0,
      mid: null,
      sendPrice: 100_000_000n,
      size: 10_000_000n,
      notional: 1_000_000_000n,
      requiredMargin: 100_000_000n,
      maxUsd: 10_000_000_000n,
      liquidation: 20_618n,
      problem: "",
      short: false,
    });
  });

  it("sizes a market sell at the bid, sends at the cap, and reduces the held long", () => {
    const account = {
      ...funded,
      positions: {
        "BTC-PERP": {
          market: "BTC-PERP",
          size: 2_000_000n,
          entry_notional: 200_000_000n,
        },
      },
    };
    expect(
      previewOrder(
        draft({ side: "sell", type: "market", usd: "99", price: "" }),
        perp,
        [perp],
        { best_bid: 99_000_000n, best_ask: 100_000_000n },
        account,
        [],
      ),
    ).toEqual({
      available: 980_000_000n,
      held: 2_000_000n,
      mid: 99_500_000n,
      sendPrice: 98_010_000n,
      size: 1_000_000n,
      notional: 99_000_000n,
      requiredMargin: 9_801_000n,
      maxUsd: 9_898_989_898n,
      liquidation: null,
      problem: "",
      short: false,
    });
  });

  it("charges no fee when the market has none", () => {
    const { maker_fee_bps: _maker, taker_fee_bps: _taker, ...feeless } = perp;
    const half = { ...funded, collateral: 500_000_000n };
    expect(
      previewOrder(draft(), feeless, [feeless], null, half, []).liquidation,
    ).toBe(51_546_391n);
    expect(
      previewOrder(draft(), perp, [perp], null, half, []).liquidation,
    ).toBe(51_567_010n);
  });

  it("names the first problem with the order", () => {
    const problem = (
      form: OrderDraft,
      market = perp,
      book: Depth | null = null,
    ) => previewOrder(form, market, [market], book, funded, []).problem;
    expect(
      problem(draft({ price: "100.5" }), { ...perp, tick_size: 1_000_000n }),
    ).toBe("off tick");
    expect(problem(draft({ type: "market" }))).toBe("no quote");
    expect(problem(draft({ usd: "" }))).toBe("enter a size in USD");
    expect(
      problem(draft({ usd: "50" }), { ...perp, lot_size: 1_000_000n }),
    ).toBe("size is below one lot");
    expect(problem(draft({ usd: "20000" }))).toBe("margin");
    expect(problem(draft({ usd: "20000", reduceOnly: true }))).toBe("");
  });

  it("has no size or liquidation without a quote or below one lot", () => {
    const noQuote = previewOrder(
      draft({ type: "market" }),
      perp,
      [perp],
      null,
      funded,
      [],
    );
    expect([
      noQuote.size,
      noQuote.notional,
      noQuote.maxUsd,
      noQuote.liquidation,
    ]).toEqual([null, null, null, null]);
    const tiny = previewOrder(
      draft({ usd: "50" }),
      { ...perp, lot_size: 1_000_000n },
      [perp],
      null,
      funded,
      [],
    );
    expect([tiny.size, tiny.liquidation]).toEqual([0n, null]);
  });

  it("previews without a market or an account", () => {
    expect(previewOrder(draft(), null, [], null, null, [])).toEqual({
      available: 0n,
      held: 0,
      mid: null,
      sendPrice: 100_000_000n,
      size: null,
      notional: null,
      requiredMargin: null,
      maxUsd: 0n,
      liquidation: null,
      problem: "",
      short: false,
    });
    const bare = previewOrder(draft(), perp, [perp], null, null, []);
    expect([bare.liquidation, bare.problem, bare.short, bare.held]).toEqual([
      103_113_402n,
      "margin",
      true,
      0,
    ]);
  });
});

describe("afterFill shorts", () => {
  it("adds to a long at the new fill", () => {
    expect(
      afterFill(
        { collateral: 1_000_000_000n, size: 100_000n, entry: 5_000_000_000n },
        100_000n,
        60_000_000_000n,
        0n,
      ),
    ).toEqual({
      collateral: 1_000_000_000n,
      size: 200_000n,
      entry: 11_000_000_000n,
    });
  });

  it("buys a short back to flat and books the profit", () => {
    expect(
      afterFill(
        { collateral: 1_000_000_000n, size: -200_000n, entry: 10_000_000_000n },
        200_000n,
        45_000_000_000n,
        0n,
      ),
    ).toEqual({ collateral: 2_000_000_000n, size: 0n, entry: 0n });
  });

  it("partly covers a short and keeps the rest of its entry", () => {
    expect(
      afterFill(
        { collateral: 1_000_000_000n, size: -200_000n, entry: 10_000_000_000n },
        50_000n,
        45_000_000_000n,
        0n,
      ),
    ).toEqual({
      collateral: 1_250_000_000n,
      size: -150_000n,
      entry: 7_500_000_000n,
    });
  });

  it("flips a short to a long, paying the fee on the whole fill", () => {
    expect(
      afterFill(
        { collateral: 1_000_000_000n, size: -100_000n, entry: 5_000_000_000n },
        300_000n,
        40_000_000_000n,
        10n,
      ),
    ).toEqual({
      collateral: 1_988_000_000n,
      size: 200_000n,
      entry: 8_000_000_000n,
    });
  });

  it("has no liquidation price for a short whose equity is already negative", () => {
    expect(
      liquidationPrice(
        { collateral: -20_000_000_000n, size: -1n, entry: 10_000_000_000n },
        300n,
      ),
    ).toBe(null);
  });
});

describe("positionRisk edges", () => {
  const market = { ...perp, max_leverage: 0 };

  it("measures the gap below a mark that has fallen past the liquidation price", () => {
    expect(
      positionRisk(
        200_000n,
        10_000_000_000n,
        1_000_000_000n,
        "40000000000",
        market,
      ),
    ).toEqual({
      liquidation: 46_391_752_577n,
      toLiquidation: 6_391_752_577n,
      margin: 10_000_000_000n,
    });
  });

  it("has no liquidation or gap when flat", () => {
    expect(positionRisk(0n, 0n, 1_000_000_000n, 1n, perp)).toEqual({
      liquidation: null,
      toLiquidation: null,
      margin: 0n,
    });
  });
});

describe("entryPrice", () => {
  it("is the entry notional per unit, for a long or a short", () => {
    expect(
      entryPrice({
        market: "BTC-PERP",
        size: -200_000n,
        entry_notional: 10_000_000_000n,
      }),
    ).toBe(50_000_000_000n);
    expect(
      entryPrice({
        market: "BTC-PERP",
        size: "400000",
        entry_notional: "20000000000",
      }),
    ).toBe(50_000_000_000n);
    expect(
      entryPrice({ market: "BTC-PERP", size: 0n, entry_notional: 5n }),
    ).toBe(0n);
  });
});

const size = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
const price = fc.bigInt({ min: 1n, max: 10n ** 14n });
const holding = fc.record({
  collateral: fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
  size,
  entry: fc.bigInt({ min: 0n, max: 10n ** 18n }),
});

describe("orders properties", () => {
  it("adds the fill to the held size", () => {
    fc.assert(
      fc.property(
        holding,
        size,
        price,
        fc.bigInt({ min: 0n, max: 100n }),
        (held, fill, p, fee) => {
          expect(afterFill(held, fill, p, fee).size).toBe(held.size + fill);
        },
      ),
    );
  });

  it("takes exactly the fee on the fill's notional off the collateral", () => {
    fc.assert(
      fc.property(
        holding,
        size,
        price,
        fc.bigInt({ min: 0n, max: 100n }),
        (held, fill, p, fee) => {
          const free = afterFill(held, fill, p, 0n);
          const paid = afterFill(held, fill, p, fee);
          const notional = (p * (fill < 0n ? -fill : fill)) / 1_000_000n;
          expect(paid).toEqual({
            ...free,
            collateral: free.collateral - (notional * fee) / 10_000n,
          });
        },
      ),
    );
  });

  it("returns to the starting collateral after opening and closing at one price", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        size,
        price,
        (collateral, fill, p) => {
          const flat = { collateral, size: 0n, entry: 0n };
          const open = afterFill(flat, fill, p, 0n);
          expect(afterFill(open, -fill, p, 0n)).toEqual(flat);
        },
      ),
    );
  });

  it("caps a market buy at or above the ask and a sell at or below the bid, within 1%", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 100n, max: 10n ** 15n }), (touch) => {
        const buy = marketPrice("buy", { best_ask: touch }) as bigint;
        const sell = marketPrice("sell", { best_bid: touch }) as bigint;
        expect(
          buy * 10_000n <= touch * 10_100n &&
            buy * 10_000n > touch * 10_100n - 10_000n,
        ).toBe(true);
        expect(
          sell * 10_000n <= touch * 9_900n &&
            sell * 10_000n > touch * 9_900n - 10_000n,
        ).toBe(true);
      }),
    );
  });

  it("buys the most whole lots the dollars cover", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        price,
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (usd, p, lot) => {
          const got = sizeFromUsd(usd, p, lot);
          expect(got % lot).toBe(0n);
          expect(got * p <= usd * 1_000_000n).toBe(true);
          expect((got + lot) * p > usd * 1_000_000n).toBe(true);
        },
      ),
    );
  });

  it("keeps available margin between zero and the account value, shrinking with each order", () => {
    const order = fc.record({
      id: fc.nat(),
      market: fc.constant("BTC-PERP"),
      side: fc.constant("buy" as const),
      price: fc.bigInt({ min: 0n, max: 10n ** 11n }),
      size: fc.bigInt({ min: 0n, max: 10n ** 9n }),
    });
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.array(order, { maxLength: 5 }),
        (value, orders) => {
          const account = { ...funded, account_value: value };
          let previous = availableMargin(account, [perp], []);
          expect(previous).toBe(value > 0n ? value : 0n);
          for (let i = 1; i <= orders.length; i++) {
            const next = availableMargin(account, [perp], orders.slice(0, i));
            expect(next >= 0n && next <= previous).toBe(true);
            previous = next;
          }
        },
      ),
    );
  });

  it("lowers a long's liquidation price as collateral grows", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (long, entry, low, extra) => {
          const at = (collateral: bigint) =>
            liquidationPrice({ collateral, size: long, entry }, 300n) ?? 0n;
          expect(at(low + extra) <= at(low)).toBe(true);
        },
      ),
    );
  });

  it("values a short the same as the long of equal size", () => {
    fc.assert(
      fc.property(size, fc.bigInt({ min: 0n, max: 10n ** 14n }), (s, mark) => {
        const value = positionValue(s, mark) as bigint;
        expect(positionValue(-s, mark)).toBe(value);
        expect(value).toBe(((s < 0n ? -s : s) * mark) / 1_000_000n);
      }),
    );
  });

  it("gives the taker and the maker of a fill opposite sides", () => {
    fc.assert(
      fc.property(fc.constantFrom("buy" as const, "sell" as const), (side) => {
        const fill = { taker: "aa", maker: "bb", side };
        expect(fillSide(fill, "aa")).toBe(side);
        expect(fillSide(fill, "bb")).toBe(side === "buy" ? "sell" : "buy");
      }),
    );
  });

  it("snaps the current price down onto the tick, within one tick", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 14n }),
        fc.bigInt({ min: 1n, max: 10n ** 7n }),
        (mark, tick) => {
          const got = currentPrice({
            ...perp,
            mark_price: mark,
            tick_size: tick,
          });
          const floor = mark - (mark % tick);
          expect(got).toBe(floor > 0n ? floor : null);
        },
      ),
    );
  });
});

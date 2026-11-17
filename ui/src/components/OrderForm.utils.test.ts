import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OrderPreview } from "../lib/orders";
import type { MarketInfo } from "../types";
import { baseAsset, feesLabel, orderToSend } from "./OrderForm.utils";

const market = (over: Partial<MarketInfo> = {}): MarketInfo => ({
  name: "BTC-USD",
  tick_size: 1,
  lot_size: 1,
  max_leverage: 10,
  maintenance_margin_bps: 500,
  oracle_price: null,
  mark_price: null,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
  ...over,
});

const preview = (over: Partial<OrderPreview> = {}): OrderPreview => ({
  available: 0n,
  held: 0,
  mid: null,
  sendPrice: 50_000_000_000n,
  size: 2_000n,
  notional: null,
  requiredMargin: null,
  maxUsd: null,
  liquidation: null,
  problem: "",
  short: false,
  ...over,
});

describe("baseAsset", () => {
  it("takes the part before the dash", () => {
    expect(baseAsset(market({ name: "BTC-USD" }))).toBe("BTC");
    expect(baseAsset(market({ name: "SOL" }))).toBe("SOL");
  });

  it("is empty without a market", () => {
    expect(baseAsset(null)).toBe("");
  });

  it("returns the dash-free prefix of any name", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes("-")),
        fc.string(),
        (base, quote) =>
          baseAsset(market({ name: base + "-" + quote })) === base,
      ),
    );
  });
});

describe("orderToSend", () => {
  it("returns the size and send price for a clean preview", () => {
    expect(orderToSend(false, preview())).toEqual({
      size: 2_000n,
      price: 50_000_000_000n,
    });
  });

  it("holds back while a send is pending", () => {
    expect(orderToSend(true, preview())).toBe(null);
  });

  it("holds back when the preview has a problem", () => {
    expect(orderToSend(false, preview({ problem: "margin" }))).toBe(null);
  });

  it("holds back without a size or send price", () => {
    expect(orderToSend(false, preview({ size: null }))).toBe(null);
    expect(orderToSend(false, preview({ sendPrice: null }))).toBe(null);
  });

  it("sends exactly when nothing blocks it, with the preview's numbers", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom("", "margin", "off tick"),
        fc.option(fc.bigInt({ min: 0n, max: 10n ** 15n })),
        fc.option(fc.bigInt({ min: 0n, max: 10n ** 15n })),
        (pending, problem, size, sendPrice) => {
          const sent = orderToSend(
            pending,
            preview({ problem, size, sendPrice }),
          );
          const ok =
            !pending && problem === "" && size != null && sendPrice != null;
          return ok
            ? sent?.size === size && sent?.price === sendPrice
            : sent === null;
        },
      ),
    );
  });
});

describe("feesLabel", () => {
  it("shows taker and maker fees as percentages", () => {
    expect(feesLabel(market({ taker_fee_bps: 5, maker_fee_bps: 2 }))).toBe(
      "0.0500% / 0.0200%",
    );
  });

  it("shows a maker rebate with its sign", () => {
    expect(feesLabel(market({ taker_fee_bps: 0, maker_fee_bps: -1 }))).toBe(
      "0.0000% / -0.0100%",
    );
  });

  it("shows a dash when either fee is unknown", () => {
    expect(feesLabel(null)).toBe("-");
    expect(feesLabel(market({ taker_fee_bps: 5 }))).toBe("-");
    expect(feesLabel(market({ maker_fee_bps: 2 }))).toBe("-");
  });
});

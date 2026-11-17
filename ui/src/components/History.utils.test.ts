import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FundingRow, MarketInfo } from "../types";
import { fundingRate } from "./History.utils";

const market = (
  name: string,
  oracle: MarketInfo["oracle_price"],
): MarketInfo => ({
  name,
  tick_size: 1,
  lot_size: 1,
  max_leverage: 10,
  maintenance_margin_bps: 500,
  oracle_price: oracle,
  mark_price: null,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
});

const row = (marketName: string, rate: FundingRow["rate"]): FundingRow => ({
  height: 7,
  market: marketName,
  index: 0,
  rate,
  ts: 0,
});

describe("fundingRate", () => {
  it("shows the rate as a share of the market's oracle price", () => {
    expect(
      fundingRate(row("BTC-USD", 1000), [
        market("ETH-USD", 1),
        market("BTC-USD", 100_000_000),
      ]),
    ).toBe("0.0010%");
  });

  it("keeps the sign of a negative rate", () => {
    expect(
      fundingRate(row("BTC-USD", "-50000"), [market("BTC-USD", 100_000_000)]),
    ).toBe("-0.0500%");
  });

  it("shows a dash when the market or its oracle is missing", () => {
    expect(fundingRate(row("BTC-USD", 1000), [market("ETH-USD", 1)])).toBe("-");
    expect(fundingRate(row("BTC-USD", 1000), [market("BTC-USD", null)])).toBe(
      "-",
    );
  });

  it("ignores markets with other names", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        fc.array(fc.tuple(fc.string(), fc.integer({ min: 1, max: 1_000_000 }))),
        (rate, oracle, others) => {
          const target = market("BTC-USD", oracle);
          const noise = others
            .filter(([name]) => name !== "BTC-USD")
            .map(([name, price]) => market(name, price));
          return (
            fundingRate(row("BTC-USD", rate), [...noise, target]) ===
            fundingRate(row("BTC-USD", rate), [target])
          );
        },
      ),
    );
  });
});

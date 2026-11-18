import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { marketKeys, MAX_TRADES } from "./marketQueries";
import { applyFrame, flushTrades } from "./stream";
import type { Candle, Trade, TradeMsg } from "../types";

const tradeMsg = (seq: number, timestamp_ms = 60_000): TradeMsg => ({
  type: "trade",
  seq,
  height: 1,
  timestamp_ms,
  market: "BTC-PERP",
  side: "buy",
  price: 101_000_000,
  size: 1,
});

describe("flushTrades", () => {
  it("keeps only the newest trades when a burst outruns the frame", () => {
    const client = new QueryClient();
    client.setQueryData<Trade[]>(marketKeys.trades("BTC-PERP"), []);
    const state = { lastAccount: 0 };
    for (let seq = 1; seq <= MAX_TRADES * 2 + 1; seq++) {
      applyFrame(client, tradeMsg(seq), state);
    }
    flushTrades(client);
    const rows = client.getQueryData<Trade[]>(marketKeys.trades("BTC-PERP"))!;
    expect(rows).toHaveLength(MAX_TRADES);
    expect(rows[0].seq).toBe(MAX_TRADES * 2 + 1);
    expect(rows[MAX_TRADES - 1].seq).toBe(MAX_TRADES + 2);
  });

  it("folds trades into loaded candles and skips intervals still loading", () => {
    const client = new QueryClient();
    const loaded: Candle[] = [
      { time: 60, open: 100, high: 100, low: 100, close: 100 },
    ];
    client.setQueryData(marketKeys.candles("BTC-PERP", "1m"), loaded);
    client
      .getQueryCache()
      .build(client, { queryKey: marketKeys.candles("BTC-PERP", "5m") });
    applyFrame(client, tradeMsg(1, 61_000), { lastAccount: 0 });
    flushTrades(client);
    expect(client.getQueryData(marketKeys.candles("BTC-PERP", "1m"))).toEqual([
      { time: 60, open: 100, high: 101, low: 100, close: 101 },
    ]);
    expect(
      client.getQueryData(marketKeys.candles("BTC-PERP", "5m")),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { applyCandles } from "./series";

describe("applyCandles", () => {
  it("builds open high low close in time order", () => {
    const next = applyCandles({ offset: 1_700_000_000 }, [
      { ts: 60_000, open: 2_000_000, high: 4_000_000, low: 1_000_000, close: 3_000_000 },
      { ts: 0, open: 1_000_000, high: 1_000_000, low: 1_000_000, close: 1_000_000 },
    ]);
    expect(next.bars).toEqual([
      { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_700_000_060, open: 2, high: 4, low: 1, close: 3 },
    ]);
  });
});

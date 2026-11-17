import fc from "fast-check";
import type { UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";

import { usd } from "../lib/scale";
import type { Candle } from "../types";
import {
  axisLabel,
  dollars,
  type Drawn,
  fitTarget,
  planDraw,
} from "./Chart.utils";

const bar = (time: number): Candle => ({
  time,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
});
const tick = (time: number) => ({ time, value: 1 });

describe("fitTarget", () => {
  it("shows the last 30 one-minute bars", () => {
    expect(fitTarget("1m", { bars: [bar(1000), bar(7200)] })).toEqual({
      from: 5400,
      to: 7200,
    });
  });

  it("shows the last 30 five-minute bars", () => {
    expect(fitTarget("5m", { bars: [bar(20_000)] })).toEqual({
      from: 11_000,
      to: 20_000,
    });
  });

  it("fits all content for ticks", () => {
    expect(fitTarget("tick", { ticks: [tick(1)], bars: [bar(60)] })).toBe(
      "content",
    );
  });

  it("does nothing without points for the span", () => {
    expect(fitTarget("1m", { bars: [], ticks: [tick(1)] })).toBe(null);
    expect(fitTarget("1m", {})).toBe(null);
    expect(fitTarget("tick", { ticks: [], bars: [bar(60)] })).toBe(null);
    expect(fitTarget("tick", {})).toBe(null);
    expect(fitTarget("tick", { ticks: [tick(2)] })).toBe("content");
  });

  it("always ends the bar window at the last bar and spans 30 intervals", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(["1m", 60] as const, ["5m", 300] as const),
        fc.array(fc.integer({ min: 0, max: 2_000_000_000 }), { minLength: 1 }),
        ([span, seconds], times) => {
          const target = fitTarget(span, { bars: times.map(bar) });
          return (
            target !== null &&
            target !== "content" &&
            target.to === times[times.length - 1] &&
            target.to - target.from === 30 * seconds
          );
        },
      ),
    );
  });
});

describe("dollars", () => {
  it("formats as US currency with grouping and cents", () => {
    expect(dollars(1234.5)).toBe("$1,234.50");
    expect(dollars(-0.5)).toBe("-$0.50");
    expect(dollars(0)).toBe("$0.00");
  });

  it("agrees with usd for whole cents", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
        (cents) => dollars(cents / 100) === usd(BigInt(cents) * 10_000n),
      ),
    );
  });
});

describe("axisLabel", () => {
  it("shows the raw height for ticks", () => {
    expect(axisLabel("tick", 42 as UTCTimestamp)).toBe("42");
  });

  it("shows local hours and minutes for bars", () => {
    const time = (new Date(2024, 0, 15, 9, 5).getTime() / 1000) as UTCTimestamp;
    expect(axisLabel("1m", time)).toBe("09:05");
    expect(axisLabel("5m", time)).toBe("09:05");
  });

  it("adds seconds for second bars", () => {
    const time = (new Date(2024, 0, 15, 9, 5, 7).getTime() /
      1000) as UTCTimestamp;
    expect(axisLabel("1s", time)).toBe("09:05:07");
    expect(axisLabel("15s", time)).toBe("09:05:07");
    expect(axisLabel("1m", time)).toBe("09:05");
  });

  it("returns nothing for non-numeric times", () => {
    expect(axisLabel("1m", "2024-01-15")).toBe("");
    expect(axisLabel("tick", { year: 2024, month: 1, day: 15 })).toBe("");
  });

  it("zero-pads any local hour and minute", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 }),
        (hour, minute, second) => {
          const time = (new Date(2024, 0, 15, hour, minute, second).getTime() /
            1000) as UTCTimestamp;
          const expected =
            (hour < 10 ? "0" : "") +
            hour +
            ":" +
            (minute < 10 ? "0" : "") +
            minute;
          return axisLabel("1m", time) === expected;
        },
      ),
    );
  });
});

describe("planDraw", () => {
  const at = (...times: number[]) => times.map((time) => ({ time }));
  const none: Drawn = { key: "", last: null, count: 0 };

  it("draws everything the first time and when the market or span changes", () => {
    expect(planDraw(none, "BTC:1m", at(1, 2)).kind).toBe("reset");
    const drawn = { key: "BTC:1m", last: 2, count: 2 };
    expect(planDraw(drawn, "BTC:5m", at(1, 2)).kind).toBe("reset");
  });

  it("only redraws from the last point it drew", () => {
    const drawn = { key: "BTC:1m", last: 2, count: 2 };
    expect(planDraw(drawn, "BTC:1m", at(1, 2))).toEqual({
      kind: "append",
      from: 1,
      drawn,
    });
    expect(planDraw(drawn, "BTC:1m", at(1, 2, 3, 4))).toEqual({
      kind: "append",
      from: 1,
      drawn: { key: "BTC:1m", last: 4, count: 4 },
    });
  });

  it("follows a window that drops old points off the front", () => {
    const drawn = { key: "BTC:tick", last: 5, count: 5 };
    expect(planDraw(drawn, "BTC:tick", at(4, 5, 6))).toMatchObject({
      kind: "append",
      from: 1,
    });
  });

  it("starts over when the last drawn point is gone or the chart grew too long", () => {
    const drawn = { key: "BTC:tick", last: 5, count: 5 };
    expect(planDraw(drawn, "BTC:tick", at(6, 7)).kind).toBe("reset");
    expect(planDraw(drawn, "BTC:tick", []).kind).toBe("reset");
    const long = { key: "BTC:tick", last: 2, count: 500 };
    expect(planDraw(long, "BTC:tick", at(1, 2)).kind).toBe("reset");
  });
});

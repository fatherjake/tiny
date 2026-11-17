import fc from "fast-check";
import type { UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";

import { usd } from "../lib/scale";
import type { Candle } from "../types";
import { axisLabel, dollars, fitTarget } from "./Chart.utils";

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

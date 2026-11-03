import { describe, expect, it } from "vitest";

import { fmt, parseScaled, pct, tryScaled, unscale, usd, usdSign } from "./scale";

describe("scale", () => {
  it("shows six decimal places and a leading minus", () => {
    expect(fmt(60_000_000_000)).toBe("60000.000000");
    expect(fmt(-1_500_000n)).toBe("-1.500000");
    expect(fmt(null)).toBe("-");
  });

  it("parses a price and drops trailing zeros on the way back", () => {
    expect(parseScaled(" 1.5 ")).toBe(1_500_000n);
    expect(parseScaled("1")).toBe(1_000_000n);
    expect(tryScaled("1.1234567")).toBe(null);
    expect(tryScaled("nope")).toBe(null);
    expect(unscale(1_500_000n)).toBe("1.5");
    expect(unscale(1_000_000n)).toBe("1");
  });
});

describe("pct", () => {
  it("shows a ratio as a percent to four places", () => {
    expect(pct(5n, 10_000n)).toBe("0.0500%");
    expect(pct(-1n, 100n)).toBe("-1.0000%");
    expect(pct(null, 100n)).toBe("-");
    expect(pct(1n, 0n)).toBe("-");
  });
});

describe("usd", () => {
  it("shows dollars with commas and cents, rounded half up", () => {
    expect(usd(1_234_567_894_999n)).toBe("$1,234,567.89");
    expect(usd(1_234_567_895_000n)).toBe("$1,234,567.90");
    expect(usd(-5_000n)).toBe("-$0.01");
    expect(usd(999_999n)).toBe("$1.00");
    expect(usd(null)).toBe("-");
  });

  it("signs a gain", () => {
    expect(usdSign(2_500_000n)).toBe("+$2.50");
    expect(usdSign(-2_500_000n)).toBe("-$2.50");
  });
});

import { describe, expect, it } from "vitest";

import { fmt, parseScaled, tryScaled, unscale } from "./scale";

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

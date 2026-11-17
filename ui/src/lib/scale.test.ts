import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  bi,
  fmt,
  fmtSign,
  parseScaled,
  pct,
  pctShort,
  short,
  shorten,
  tryScaled,
  unscale,
  usd,
  usdSign,
} from "./scale";

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

describe("shorten", () => {
  it("keeps the ends of a wallet address and a trader key", () => {
    expect(shorten("0x1234567890abcdef1234567890abcdef12345678", 5, 3)).toBe(
      "0x123...678",
    );
    expect(shorten("a".repeat(30) + "1234", 4, 4)).toBe("aaaa...1234");
  });

  it("leaves a value that would not get shorter", () => {
    expect(shorten("0x1234567", 5, 3)).toBe("0x1234567");
  });
});

describe("pctShort", () => {
  it("rounds toward zero at two places", () => {
    expect(pctShort(3_608_247_423n, 50_000_000_000n)).toBe("7.21%");
    expect(pctShort(-7n, 1_000n)).toBe("-0.70%");
    expect(pctShort(1n, 0n)).toBe("-");
  });
});

describe("bi", () => {
  it("reads bigints, safe integers and integer strings", () => {
    expect(bi(5n)).toBe(5n);
    expect(bi(-12)).toBe(-12n);
    expect(bi("-340282366920938463463374607431768211456")).toBe(-(2n ** 128n));
  });

  it("refuses anything that is not an exact integer", () => {
    expect(() => bi(2 ** 53)).toThrow("use bigint above 2^53");
    expect(() => bi(1.5)).toThrow("use bigint above 2^53");
    expect(() => bi("1.5")).toThrow("not an int");
    expect(() => bi("")).toThrow("not an int");
    expect(() => bi(null as unknown as bigint)).toThrow("not an int");
  });
});

describe("fmtSign", () => {
  it("adds a plus to a gain only", () => {
    expect(fmtSign(1_500_000n)).toBe("+1.500000");
    expect(fmtSign("-250000")).toBe("-0.250000");
    expect(fmtSign(0)).toBe("0.000000");
    expect(fmtSign(null)).toBe("-");
    expect(fmtSign("")).toBe("-");
  });
});

describe("short", () => {
  it("keeps the first eight characters", () => {
    expect(short("abcdef0123456789")).toBe("abcdef01");
    expect(short(1234567890)).toBe("12345678");
    expect(short("ab")).toBe("ab");
    expect(short(null)).toBe("-");
    expect(short(undefined)).toBe("-");
    expect(short("")).toBe("-");
  });
});

describe("more formatting", () => {
  it("unscales a negative and blanks the empty inputs", () => {
    expect(unscale(-1_050_000n)).toBe("-1.05");
    expect(unscale("-7")).toBe("-0.000007");
    expect(fmt("")).toBe("-");
    expect(fmt(undefined)).toBe("-");
    expect(usd("")).toBe("-");
    expect(usdSign(null)).toBe("-");
    expect(usdSign("")).toBe("-");
    expect(usdSign(0n)).toBe("$0.00");
    expect(pct(1n, undefined)).toBe("-");
    expect(pctShort(null, 1n)).toBe("-");
    expect(pctShort(1n, undefined)).toBe("-");
    expect(pctShort(1_234n, 10_000n)).toBe("12.34%");
  });

  it("refuses negative and malformed input", () => {
    expect(tryScaled("-1")).toBe(null);
    expect(tryScaled("1.")).toBe(null);
    expect(tryScaled(".5")).toBe(null);
    expect(tryScaled("0.000001")).toBe(1n);
  });
});

const amount = fc.bigInt({ min: 0n, max: 10n ** 30n });

describe("scale properties", () => {
  it("parses what unscale prints back to the same amount", () => {
    fc.assert(
      fc.property(amount, (n) => {
        expect(parseScaled(unscale(n))).toBe(n);
      }),
    );
  });

  it("parses what fmt prints back to the same amount", () => {
    fc.assert(
      fc.property(amount, (n) => {
        expect(fmt(n)).toMatch(/^\d+\.\d{6}$/);
        expect(parseScaled(fmt(n))).toBe(n);
      }),
    );
  });

  it("prints a negative as the positive with a leading minus", () => {
    fc.assert(
      fc.property(
        amount.filter((n) => n > 0n),
        (n) => {
          expect(fmt(-n)).toBe("-" + fmt(n));
          expect(unscale(-n)).toBe("-" + unscale(n));
          expect(usd(-n)).toBe("-" + usd(n));
          expect(fmtSign(n)).toBe("+" + fmt(n));
        },
      ),
    );
  });

  it("parses any decimal with up to six places to its exact value", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 20n }),
        fc.integer({ min: 0, max: 6 }),
        (units, places) => {
          const digits = units.toString().padStart(places + 1, "0");
          const text =
            places === 0
              ? digits
              : digits.slice(0, -places) + "." + digits.slice(-places);
          expect(parseScaled(text)).toBe(units * 10n ** BigInt(6 - places));
        },
      ),
    );
  });

  it("rounds usd to the nearest cent, half up, with grouped thousands", () => {
    fc.assert(
      fc.property(amount, (n) => {
        const cents = (n + 5_000n) / 10_000n;
        const text = usd(n);
        expect(text).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(BigInt(text.replace(/[$,.]/g, ""))).toBe(cents);
      }),
    );
  });

  it("never lengthens a value and keeps both ends when it shortens", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.nat(10),
        fc.integer({ min: 1, max: 10 }),
        (value, head, tail) => {
          const out = shorten(value, head, tail);
          expect(out.length).toBeLessThanOrEqual(value.length);
          if (out !== value) {
            expect(out).toBe(
              value.slice(0, head) + "..." + value.slice(value.length - tail),
            );
          }
        },
      ),
    );
  });

  it("reads a percent that matches the ratio to four places, toward zero", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        (part, whole) => {
          const text = pct(part, whole);
          const value = BigInt(text.replace(/[.%]/g, ""));
          expect(value).toBe((part * 1_000_000n) / whole);
          expect(pctShort(part, whole)).toBe(
            text.slice(0, -3).replace(/^-0\.00$/, "0.00") + "%",
          );
        },
      ),
    );
  });
});

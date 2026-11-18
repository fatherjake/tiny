import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EAGER, OVERSCAN, ROW_H, visible } from "./Tape.utils";

describe("visible", () => {
  it("renders the first rows eagerly at the top", () => {
    expect(visible(10_000, 0, 400)).toEqual([0, EAGER]);
    expect(visible(30, 0, 400)).toEqual([0, 30]);
  });

  it("windows around the viewport once scrolled", () => {
    const [start, end] = visible(10_000, 500 * ROW_H, 20 * ROW_H);
    expect(start).toBe(500 - OVERSCAN);
    expect(end).toBe(520 + OVERSCAN);
  });

  it("clamps to the list at the bottom", () => {
    expect(visible(100, 100 * ROW_H, 20 * ROW_H)).toEqual([
      100 - OVERSCAN,
      100,
    ]);
  });

  it("always covers the viewport within the list", () => {
    fc.assert(
      fc.property(
        fc.nat(20_000),
        fc.nat(400_000),
        fc.nat(2_000),
        (count, top, height) => {
          const [start, end] = visible(count, top, height);
          const first = Math.min(count, Math.floor(top / ROW_H));
          const last = Math.min(count, Math.ceil((top + height) / ROW_H));
          return (
            start >= 0 &&
            end <= count &&
            start <= end &&
            (top === 0 || (start <= first && end >= last))
          );
        },
      ),
    );
  });
});

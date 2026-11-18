import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AHEAD, BEHIND, EAGER, ROW_H, visible } from "./Tape.utils";

describe("visible", () => {
  it("renders the first rows eagerly at the top", () => {
    expect(visible(10_000, 0, 400)).toEqual([0, EAGER]);
    expect(visible(30, 0, 400)).toEqual([0, 30]);
  });

  it("overscans further below when scrolling down", () => {
    expect(visible(10_000, 500 * ROW_H, 20 * ROW_H, 1)).toEqual([
      500 - BEHIND,
      520 + AHEAD,
    ]);
  });

  it("overscans further above when scrolling up", () => {
    expect(visible(10_000, 500 * ROW_H, 20 * ROW_H, -1)).toEqual([
      500 - AHEAD,
      520 + BEHIND,
    ]);
  });

  it("clamps to the list at the bottom", () => {
    expect(visible(100, 100 * ROW_H, 20 * ROW_H, 1)).toEqual([
      100 - BEHIND,
      100,
    ]);
  });

  it("always covers the viewport within the list", () => {
    fc.assert(
      fc.property(
        fc.nat(20_000),
        fc.nat(400_000),
        fc.nat(2_000),
        fc.constantFrom<1 | -1>(1, -1),
        (count, top, height, direction) => {
          const [start, end] = visible(count, top, height, direction);
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

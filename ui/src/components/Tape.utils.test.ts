import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Trade } from "../types";
import { nextFade, seqs } from "./Tape.utils";

const trade = (seq: number): Trade => ({
  seq,
  height: 1,
  timestamp_ms: 0,
  market: "BTC-USD",
  side: "sell",
  price: 1,
  size: 1,
});

describe("seqs", () => {
  it("collects the sequence numbers of the prints", () => {
    expect(seqs([trade(3), trade(1), trade(3)])).toEqual(new Set([1, 3]));
  });

  it("holds exactly the distinct sequence numbers", () => {
    fc.assert(
      fc.property(fc.array(fc.nat()), (values) => {
        const set = seqs(values.map(trade));
        return (
          set.size === new Set(values).size && values.every((v) => set.has(v))
        );
      }),
    );
  });
});

describe("nextFade", () => {
  const rows = (...values: number[]) => values.map(trade);

  it("fades in a trickle of new prints", () => {
    expect(nextFade(rows(2, 1), rows(4, 3, 2, 1), new Set())).toEqual(
      new Set([4, 3]),
    );
  });

  it("does not fade a burst, so a busy tape stays readable", () => {
    expect(nextFade(rows(1), rows(6, 5, 4, 3, 2, 1), new Set())).toEqual(
      new Set(),
    );
  });

  it("does not fade the first load", () => {
    expect(nextFade([], rows(2, 1), new Set())).toEqual(new Set());
  });

  it("keeps fading rows that are still on screen and forgets the rest", () => {
    const visible = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(
      nextFade(rows(...visible), rows(...visible), new Set([100, 5])),
    ).toEqual(new Set([100]));
  });
});

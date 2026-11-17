import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Trade } from "../types";
import { seqs } from "./Tape.utils";

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

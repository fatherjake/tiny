import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { advance, START, type StreamCursor } from "./gaps";
import type { WsMessage } from "../types";

const block = (height: number): WsMessage => ({
  type: "block",
  height,
  hash: "ab",
  view: 0,
});

const trade = (seq: number): WsMessage => ({
  type: "trade",
  seq,
  height: 1,
  timestamp_ms: 0,
  market: "BTC",
  side: "buy",
  price: 1,
  size: 1,
});

const book: WsMessage = { type: "book", market: "BTC", bids: [], asks: [] };

function run(msgs: WsMessage[]): boolean[] {
  let cursor: StreamCursor = START;
  return msgs.map((msg) => {
    const next = advance(cursor, msg);
    cursor = next.cursor;
    return next.gap;
  });
}

describe("advance", () => {
  it("accepts the first frame of each kind without a gap", () => {
    expect(run([block(7), trade(40)])).toEqual([false, false]);
  });

  it("accepts consecutive blocks and trades", () => {
    expect(run([block(1), trade(1), trade(2), block(2), trade(3)])).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("flags a skipped block height", () => {
    expect(run([block(1), block(3)])).toEqual([false, true]);
  });

  it("flags a skipped trade seq", () => {
    expect(run([trade(1), trade(2), trade(5)])).toEqual([false, false, true]);
  });

  it("flags a trade seq that goes backwards", () => {
    expect(run([trade(9), trade(1), trade(2)])).toEqual([false, true, false]);
  });

  it("never flags book snapshots", () => {
    expect(run([block(1), book, book, block(2)])).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("advance properties", () => {
  it("never flags a run of consecutive blocks and trades from any start", () => {
    fc.assert(
      fc.property(
        fc.nat(10 ** 6),
        fc.nat(10 ** 6),
        fc.array(fc.constantFrom("block", "trade", "book")),
        (height, seq, kinds) => {
          let h = height;
          let s = seq;
          const msgs = kinds.map((kind) =>
            kind === "block"
              ? block(h++)
              : kind === "trade"
                ? trade(s++)
                : book,
          );
          expect(run(msgs)).toEqual(msgs.map(() => false));
        },
      ),
    );
  });

  it("flags a block exactly when its height is not one past the last block", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(20), { minLength: 1 }), (heights) => {
        expect(run(heights.map(block))).toEqual(
          heights.map((h, i) => i > 0 && h !== heights[i - 1] + 1),
        );
      }),
    );
  });

  it("tracks blocks and trades independently, ignoring books", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(20)),
        fc.array(fc.nat(20)),
        fc.array(fc.nat(2)),
        (heights, seqs, order) => {
          const blocks = heights.map(block);
          const trades = seqs.map(trade);
          const mixed: WsMessage[] = [];
          let b = 0;
          let t = 0;
          for (const pick of order) {
            if (pick === 0 && b < blocks.length) mixed.push(blocks[b++]);
            else if (pick === 1 && t < trades.length) mixed.push(trades[t++]);
            else mixed.push(book);
          }
          mixed.push(...blocks.slice(b), ...trades.slice(t));
          const flags = run(mixed);
          const blockFlags = flags.filter((_, i) => mixed[i].type === "block");
          const tradeFlags = flags.filter((_, i) => mixed[i].type === "trade");
          expect(blockFlags).toEqual(run(blocks));
          expect(tradeFlags).toEqual(run(trades));
          expect(flags.filter((_, i) => mixed[i].type === "book")).toEqual(
            mixed.filter((msg) => msg.type === "book").map(() => false),
          );
        },
      ),
    );
  });
});

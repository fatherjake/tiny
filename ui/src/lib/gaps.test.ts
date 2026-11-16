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

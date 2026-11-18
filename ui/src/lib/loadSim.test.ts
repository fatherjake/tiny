import { QueryClient } from "@tanstack/react-query";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  due,
  fakeBlock,
  fakeTrade,
  jiggle,
  LoadSim,
  SIM_HASH,
  walk,
} from "./loadSim";
import { feedQuery, marketKeys } from "./marketQueries";
import { flushTrades } from "./stream";
import type { BlockMsg, Depth, Trade } from "../types";

const fixed = (value: number) => () => value;

describe("due", () => {
  it("spreads a rate over ticks without losing the fractions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1 }),
        (rate, ticks) => {
          let carry = 0;
          let total = 0;
          for (const ms of ticks) {
            const next = due(rate, ms, carry);
            total += next.count;
            carry = next.carry;
          }
          const expected = (rate * ticks.reduce((a, b) => a + b, 0)) / 1000;
          return Math.abs(total + carry - expected) < 1e-6;
        },
      ),
    );
  });

  it("sends nothing for a zero or negative rate", () => {
    expect(due(0, 1000, 0).count).toBe(0);
    expect(due(-5, 1000, 0).count).toBe(0);
  });
});

describe("fake frames", () => {
  it("keeps the price positive and close to where it was", () => {
    expect(walk(100, fixed(1))).toBeCloseTo(100.02);
    expect(walk(100, fixed(0))).toBeCloseTo(99.98);
    expect(walk(0.5, fixed(0))).toBe(1);
  });

  it("drifts back towards where it started instead of wandering off", () => {
    let price = 100;
    for (let i = 0; i < 20_000; i++) price = walk(price, fixed(0.5), 120);
    expect(price).toBeGreaterThan(110);
  });

  it("makes trades with seqs that never clash with the chain's", () => {
    const trade = fakeTrade(3, "BTC-PERP", 50_000.5, 9, fixed(0.25));
    expect(trade).toMatchObject({
      type: "trade",
      market: "BTC-PERP",
      side: "buy",
      price: 50_000_500_000,
      height: 9,
      size: 125_000,
    });
    expect(trade.seq).toBeGreaterThan(1e12);
  });

  it("only touches book sizes, never prices", () => {
    const book = {
      bids: [[100, 5]] as [number, number][],
      asks: [[101, 7]] as [number, number][],
    };
    const next = jiggle(book, "BTC-PERP", fixed(0.1));
    expect(next.bids?.[0][0]).toBe(100);
    expect(next.asks?.[0][0]).toBe(101);
    expect(next.bids?.[0][1]).toBe(3);
    expect(next.type).toBe("book");
  });

  it("leaves a level alone four times in five", () => {
    const next = jiggle(
      { bids: [[100, 5]], asks: undefined },
      "BTC-PERP",
      fixed(0.5),
    );
    expect(next.bids).toEqual([[100, 5]]);
    expect(next.asks).toEqual([]);
  });

  it("marks fake blocks so they can be cleared out afterwards", () => {
    const block = fakeBlock(12, 500, 7);
    expect(block).toMatchObject({ height: 500, view: 7 });
    expect(block.hash.startsWith(SIM_HASH)).toBe(true);
    expect(block.txs).toHaveLength(20);
  });
});

describe("LoadSim", () => {
  let clock = 0;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const MARKET = "BTC-PERP";

  function client(seed: { trades?: Trade[]; book?: Depth; marks?: number }) {
    const qc = new QueryClient();
    qc.setQueryData(marketKeys.status, { height: 9, view: 4 });
    if (seed.trades) qc.setQueryData(marketKeys.trades(MARKET), seed.trades);
    if (seed.book) qc.setQueryData(marketKeys.books, { [MARKET]: seed.book });
    if (seed.marks != null) {
      qc.setQueryData(marketKeys.list, [
        { name: "ETH-PERP", mark_price: 1 },
        { name: MARKET, mark_price: seed.marks },
      ]);
    }
    return qc;
  }

  function step(ms = 50) {
    clock += ms;
    vi.advanceTimersByTime(50);
  }

  async function settle(sim: LoadSim) {
    for (let i = 0; i < 10_000 && sim.backlog > 0; i++) {
      await new Promise((done) => setTimeout(done, 0));
    }
  }

  const realTrade: Trade = {
    seq: 5,
    height: 1,
    timestamp_ms: 0,
    market: MARKET,
    side: "buy",
    price: 60_000_000_000,
    size: 1,
  };

  async function firstFakePrice(qc: QueryClient) {
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    sim.start({ trades: 20, books: 0, blocks: 0 });
    step();
    await settle(sim);
    flushTrades(qc);
    const price = qc.getQueryData<Trade[]>(marketKeys.trades(MARKET))?.[0]
      ?.price;
    sim.stop();
    return price;
  }

  it("streams fake trades from the newest real price into the cache", async () => {
    const qc = client({ trades: [realTrade] });
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    expect(sim.running).toBe(false);
    sim.start({ trades: 20, books: 0, blocks: 0 });
    expect(sim.running).toBe(true);
    step();
    await settle(sim);
    flushTrades(qc);
    expect(qc.getQueryData<Trade[]>(marketKeys.trades(MARKET))).toEqual([
      {
        seq: 1_000_000_000_001,
        height: 9,
        timestamp_ms: expect.any(Number),
        market: MARKET,
        side: "sell",
        price: 60_000_000_000,
        size: 250_000,
      },
      realTrade,
    ]);
    expect([sim.generated, sim.applied, sim.backlog]).toEqual([1, 1, 0]);
    sim.stop();
  });

  it("falls back to the book mark, the market mark, then 50,000", async () => {
    const book = { mark_price: 70_000_000_000, bids: [], asks: [] } as Depth;
    expect(await firstFakePrice(client({ trades: [], book }))).toBe(
      70_000_000_000,
    );
    expect(
      await firstFakePrice(client({ trades: [], marks: 80_000_000_000 })),
    ).toBe(80_000_000_000);
    expect(await firstFakePrice(client({ trades: [] }))).toBe(50_000_000_000);
  });

  it("stamps blocks at height and view 0 before any status arrives", async () => {
    const qc = new QueryClient();
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    sim.start({ trades: 20, books: 0, blocks: 20 });
    step();
    await settle(sim);
    expect(qc.getQueryData<BlockMsg[]>(feedQuery.queryKey)).toMatchObject([
      { hash: "sim00000001", height: 0, view: 0 },
    ]);
    sim.stop();
  });

  it("sends book updates only when there is a book, and marked blocks", async () => {
    const book = {
      mark_price: 70_000_000_000,
      bids: [[69_000_000_000, 5]],
      asks: [[71_000_000_000, 7]],
    } as Depth;
    const qc = client({ book });
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    sim.start({ trades: 0, books: 20, blocks: 20 });
    step();
    await settle(sim);
    expect(sim.generated).toBe(2);
    expect(qc.getQueryData<BlockMsg[]>(feedQuery.queryKey)).toMatchObject([
      { hash: "sim00000001", height: 9, view: 4 },
    ]);
    expect(
      qc.getQueryData<Record<string, Depth>>(marketKeys.books)?.[MARKET],
    ).toMatchObject({ type: "book", bids: [[69_000_000_000, 5]] });
    sim.stop();

    const bare = new LoadSim(client({}), MARKET, fixed(0.5));
    bare.start({ trades: 0, books: 20, blocks: 0 });
    step();
    expect(bare.generated).toBe(0);
    bare.stop();
  });

  it("caps a stalled tick at one second of messages", () => {
    const sim = new LoadSim(client({}), MARKET, fixed(0.5));
    sim.start({ trades: 20, books: 0, blocks: 0 });
    step(10_000);
    expect(sim.generated).toBe(20);
    sim.stop();
  });

  it("only changes the rates when started again", () => {
    const sim = new LoadSim(client({}), MARKET, fixed(0.5));
    sim.start({ trades: 20, books: 0, blocks: 0 });
    sim.start({ trades: 40, books: 0, blocks: 0 });
    step();
    expect(sim.rates.trades).toBe(40);
    expect(sim.generated).toBe(2);
    sim.stop();
  });

  it("clears its own trades and blocks on stop and keeps the real ones", async () => {
    const realBlock: BlockMsg = {
      type: "block",
      height: 1,
      hash: "abc",
      view: 1,
      txs: [],
    };
    const qc = client({ trades: [realTrade] });
    qc.setQueryData(feedQuery.queryKey, [realBlock]);
    qc.setQueryData(marketKeys.list, []);
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    sim.start({ trades: 200, books: 0, blocks: 20 });
    step();
    await settle(sim);
    step();
    expect(sim.backlog).toBeGreaterThan(0);
    sim.stop();
    expect([sim.running, sim.backlog]).toEqual([false, 0]);
    expect(qc.getQueryData(marketKeys.trades(MARKET))).toEqual([realTrade]);
    expect(qc.getQueryData(feedQuery.queryKey)).toEqual([realBlock]);
    expect(qc.getQueryState(marketKeys.list)?.isInvalidated).toBe(true);
    const applied = sim.applied;
    await new Promise((done) => setTimeout(done, 10));
    expect(sim.applied).toBe(applied);

    const leftover = { ...realTrade, seq: 2_000_000_000_000 };
    qc.setQueryData(marketKeys.trades(MARKET), [leftover]);
    sim.stop();
    expect(qc.getQueryData(marketKeys.trades(MARKET))).toEqual([leftover]);
  });

  it("drains a large burst completely", async () => {
    const qc = client({ trades: [] });
    const sim = new LoadSim(qc, MARKET, fixed(0.5));
    sim.start({ trades: 100_000, books: 0, blocks: 0 });
    step();
    expect(sim.generated).toBe(5_000);
    await settle(sim);
    expect([sim.applied, sim.backlog]).toEqual([5_000, 0]);
    flushTrades(qc);
    expect(qc.getQueryData<Trade[]>(marketKeys.trades(MARKET))).toHaveLength(
      5_000,
    );
    sim.stop();
  });

  it("accounts for every message it generates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          trades: fc.integer({ min: 0, max: 400 }),
          books: fc.integer({ min: 0, max: 400 }),
          blocks: fc.integer({ min: 0, max: 400 }),
        }),
        fc.array(fc.integer({ min: 1, max: 300 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (rates, ticks) => {
          const book = { bids: [[1, 1]], asks: [] } as Depth;
          const sim = new LoadSim(
            client({ trades: [], book }),
            MARKET,
            fixed(0.5),
          );
          sim.start(rates);
          for (const ms of ticks) {
            step(ms);
            expect(sim.applied + sim.backlog).toBe(sim.generated);
          }
          await settle(sim);
          expect(sim.applied).toBe(sim.generated);
          sim.stop();
        },
      ),
      { numRuns: 20 },
    );
  });
});

import type { QueryClient } from "@tanstack/react-query";

import { feedQuery, marketKeys } from "./marketQueries";
import { applyFrame, flushTrades, type FrameState } from "./stream";
import type {
  BlockMsg,
  BookMsg,
  Depth,
  Level,
  MarketInfo,
  Status,
  Trade,
  TradeMsg,
  WsMessage,
} from "../types";

export type Rates = { trades: number; books: number; blocks: number };

export const SIM_HASH = "sim";
const TICK_MS = 50;
const MAX_STEP_MS = 1_000;
const SEQ_BASE = 1_000_000_000_000;
const TXS_PER_BLOCK = 20;

export function due(
  rate: number,
  ms: number,
  carry: number,
): { count: number; carry: number } {
  const exact = (Math.max(0, rate) * ms) / 1000 + carry;
  const count = Math.floor(exact);
  return { count, carry: exact - count };
}

export function walk(price: number, rng: () => number, anchor = price): number {
  const pull = (anchor - price) * 0.001;
  return Math.max(1, price * (1 + (rng() - 0.5) * 0.0004) + pull);
}

export function fakeTrade(
  n: number,
  market: string,
  price: number,
  height: number,
  rng: () => number,
): TradeMsg {
  return {
    type: "trade",
    seq: SEQ_BASE + n,
    height,
    timestamp_ms: Date.now(),
    market,
    side: rng() < 0.5 ? "buy" : "sell",
    price: Math.round(price * 1e6),
    size: Math.max(1, Math.round(rng() * 500_000)),
  };
}

export function jiggle(
  book: Depth,
  market: string,
  rng: () => number,
): BookMsg {
  const tweak = (levels: Level[] = []): Level[] =>
    levels.map(([price, size]) =>
      rng() < 0.2
        ? [price, Math.max(1, Math.round(Number(size) * (0.5 + rng())))]
        : [price, size],
    );
  return {
    ...book,
    type: "book",
    market,
    bids: tweak(book.bids),
    asks: tweak(book.asks),
  };
}

export function fakeBlock(n: number, height: number, view: number): BlockMsg {
  return {
    type: "block",
    height,
    hash: SIM_HASH + n.toString(16).padStart(8, "0"),
    view,
    txs: Array.from({ length: TXS_PER_BLOCK }, (_, i) => ({
      kind: i % 4 === 0 ? "cancel_order" : "place_order",
      signer: SIM_HASH + (i % 7),
      nonce: n * TXS_PER_BLOCK + i,
    })),
  };
}

export class LoadSim {
  rates: Rates = { trades: 0, books: 0, blocks: 0 };
  applied = 0;
  generated = 0;
  private queue: WsMessage[] = [];
  private head = 0;
  private timer: number | null = null;
  private channel: MessageChannel | null = null;
  private carry: Rates = { trades: 0, books: 0, blocks: 0 };
  private last = 0;
  private n = 0;
  private price = 0;
  private anchor = 0;
  private blocks = 0;
  private frames: FrameState = { lastAccount: 0 };

  constructor(
    private client: QueryClient,
    private market: string,
    private rng: () => number = Math.random,
  ) {}

  get running(): boolean {
    return this.timer != null;
  }

  get backlog(): number {
    return this.queue.length - this.head;
  }

  start(rates: Rates): void {
    this.rates = rates;
    if (this.timer != null) return;
    const trades = this.client.getQueryData<Trade[]>(
      marketKeys.trades(this.market),
    );
    const book = this.client.getQueryData<Record<string, Depth>>(
      marketKeys.books,
    )?.[this.market];
    const markets = this.client.getQueryData<MarketInfo[]>(marketKeys.list);
    const start =
      trades?.[0]?.price ??
      book?.mark_price ??
      markets?.find((m) => m.name === this.market)?.mark_price;
    this.price = start != null ? Number(start) / 1e6 : 50_000;
    this.anchor = this.price;
    this.channel = new MessageChannel();
    this.channel.port1.onmessage = () => this.drain();
    this.last = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer == null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.channel?.port1.close();
    this.channel = null;
    this.queue = [];
    this.head = 0;
    flushTrades(this.client);
    this.client.setQueryData<Trade[]>(marketKeys.trades(this.market), (rows) =>
      rows?.filter((trade) => trade.seq < SEQ_BASE),
    );
    this.client.setQueryData<BlockMsg[]>(feedQuery.queryKey, (rows = []) =>
      rows.filter((block) => !block.hash.startsWith(SIM_HASH)),
    );
    void this.client.invalidateQueries({ queryKey: marketKeys.all });
  }

  private count(key: keyof Rates, ms: number): number {
    const next = due(this.rates[key], ms, this.carry[key]);
    this.carry[key] = next.carry;
    return next.count;
  }

  private tick(): void {
    const now = performance.now();
    const ms = Math.min(MAX_STEP_MS, now - this.last);
    this.last = now;
    const status = this.client.getQueryData<Status>(marketKeys.status);
    const height = status?.height ?? 0;
    for (let i = this.count("trades", ms); i > 0; i--) {
      this.n++;
      this.price = walk(this.price, this.rng, this.anchor);
      this.push(fakeTrade(this.n, this.market, this.price, height, this.rng));
    }
    const book = this.client.getQueryData<Record<string, Depth>>(
      marketKeys.books,
    )?.[this.market];
    for (let i = this.count("books", ms); i > 0; i--) {
      if (book) this.push(jiggle(book, this.market, this.rng));
    }
    for (let i = this.count("blocks", ms); i > 0; i--) {
      this.blocks++;
      this.push(fakeBlock(this.blocks, height, status?.view ?? 0));
    }
  }

  private push(msg: WsMessage): void {
    this.queue.push(msg);
    this.generated++;
    this.channel?.port2.postMessage(null);
  }

  private drain(): void {
    if (this.head >= this.queue.length) return;
    const msg = this.queue[this.head++];
    if (this.head > 4096 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    applyFrame(this.client, msg, this.frames);
    this.applied++;
  }
}

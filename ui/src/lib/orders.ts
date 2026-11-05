import type { AccountView, Depth, MarketInfo, OpenOrder, Position, StoredOrder } from "../types";
import { SCALE, bi } from "./scale";

const MARKET_SLIPPAGE_BPS = 100n;

export function marketPrice(side: "buy" | "sell", book: Depth | null): bigint | null {
  if (book == null) return null;
  const raw = side === "buy" ? book.best_ask : book.best_bid;
  if (raw == null) return null;
  const touch = bi(raw);
  if (touch <= 0n) return null;
  const band = side === "buy" ? 10_000n + MARKET_SLIPPAGE_BPS : 10_000n - MARKET_SLIPPAGE_BPS;
  const price = (touch * band) / 10_000n;
  return price > 0n ? price : null;
}

export function gridNote(
  market: MarketInfo | null,
  size: bigint | null,
  price: bigint | null,
  orderType: "limit" | "market",
): string {
  if (size != null && market && bi(market.lot_size) > 0n && size % bi(market.lot_size) !== 0n) {
    return "off lot";
  }
  if (orderType === "limit" && price != null && market && bi(market.tick_size) > 0n) {
    if (price % bi(market.tick_size) !== 0n) return "off tick";
  }
  return "";
}

export function currentPrice(market: MarketInfo | null): bigint | null {
  const raw = market?.mark_price ?? market?.oracle_price;
  if (market == null || raw == null) return null;
  const price = bi(raw);
  const tick = bi(market.tick_size);
  const snapped = tick > 0n ? price - (price % tick) : price;
  return snapped > 0n ? snapped : null;
}

export function midPrice(market: MarketInfo | null, book: Depth | null): bigint | null {
  if (market == null || book?.best_bid == null || book.best_ask == null) return null;
  const mid = (bi(book.best_bid) + bi(book.best_ask)) / 2n;
  const tick = bi(market.tick_size);
  const snapped = tick > 0n ? mid - (mid % tick) : mid;
  return snapped > 0n ? snapped : null;
}

// Dollars to a base size at `price`, rounded down to the lot.
export function sizeFromUsd(usd: bigint, price: bigint, lot: bigint): bigint {
  if (price <= 0n) return 0n;
  const size = (usd * SCALE) / price;
  return lot > 0n ? size - (size % lot) : size;
}

// What the chain checks a new order against: account value less the initial margin, at each
// market's max leverage, of open positions at mark and of resting orders.
export function availableMargin(
  account: AccountView | null,
  markets: MarketInfo[],
  orders: OpenOrder[],
): bigint {
  if (account == null) return 0n;
  const lev = (name: string) => BigInt(markets.find((m) => m.name === name)?.max_leverage || 1);
  let used = 0n;
  for (const pos of Object.values(account.positions ?? {})) {
    const market = markets.find((m) => m.name === pos.market);
    const mark = market?.mark_price ?? market?.oracle_price;
    if (mark == null) continue;
    const size = bi(pos.size);
    used += ((size < 0n ? -size : size) * bi(mark)) / SCALE / lev(pos.market);
  }
  for (const order of orders) {
    used += (bi(order.size) * bi(order.price)) / SCALE / lev(order.market);
  }
  const free = bi(account.account_value ?? 0) - used;
  return free > 0n ? free : 0n;
}

export type Holding = { collateral: bigint; size: bigint; entry: bigint };

// The account after filling `size` (signed: >0 buys) at `price`, as core/state.py _apply_fill.
export function afterFill(held: Holding, size: bigint, price: bigint, feeBps: bigint): Holding {
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const notional = (price * abs(size)) / SCALE;
  let collateral = held.collateral - (notional * feeBps) / 10_000n;
  const old = held.size;
  const next = old + size;
  if (old === 0n || old > 0n === size > 0n) {
    return { collateral, size: next, entry: held.entry + notional };
  }
  const closing = next === 0n || next > 0n === old > 0n;
  const closed = closing ? abs(size) : abs(old);
  const closedEntry = closed === abs(old) ? held.entry : (held.entry * closed) / abs(old);
  const closedNotional = (price * closed) / SCALE;
  collateral += old > 0n ? closedNotional - closedEntry : closedEntry - closedNotional;
  if (next === 0n) return { collateral, size: 0n, entry: 0n };
  const entry = closing ? held.entry - closedEntry : (price * abs(next)) / SCALE;
  return { collateral, size: next, entry };
}

// The mark at which account value falls to maintenance margin, for one market held in cross.
// Long: C + s*p - E = s*p*mm. Short: C + E - s*p = s*p*mm. Null when flat or never liquidated.
export function liquidationPrice(held: Holding, maintenanceBps: bigint): bigint | null {
  const { collateral, size, entry } = held;
  if (size === 0n) return null;
  const price =
    size > 0n
      ? ((entry - collateral) * SCALE * 10_000n) / (size * (10_000n - maintenanceBps))
      : ((collateral + entry) * SCALE * 10_000n) / (-size * (10_000n + maintenanceBps));
  return price > 0n ? price : null;
}

// "0.0500%" from 5 bps.
export function bpsPct(bps: number): string {
  return (bps / 100).toFixed(4) + "%";
}

const REASONS: Record<string, string> = {
  margin: "not enough margin",
  nonce: "stale nonce, try again",
  duplicate: "order id already resting",
  unmatched: "nothing to match against",
  tick: "price is off tick",
  lot: "size is off lot",
  size: "size must be positive",
  market: "unknown market",
  signer: "signed by a different key",
};

export function outcome(row: Pick<StoredOrder, "order_id" | "status" | "reason">): string {
  const head = "order " + row.order_id + " " + row.status;
  if (!row.reason) return head;
  return head + ": " + (REASONS[row.reason] ?? row.reason);
}

export type CloseOrder = { side: "buy" | "sell"; size: bigint; price: bigint };

// Closing is a reduce-only market order for the whole position on the other side.
export function closeOrder(pos: Position, book: Depth | null): CloseOrder | null {
  const size = bi(pos.size);
  if (size === 0n) return null;
  const side = size > 0n ? "sell" : "buy";
  const price = marketPrice(side, book);
  if (price == null) return null;
  return { side, size: size > 0n ? size : -size, price };
}

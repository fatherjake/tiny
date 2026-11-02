import type { Depth, MarketInfo, Position, StoredOrder } from "../types";
import { bi } from "./scale";

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

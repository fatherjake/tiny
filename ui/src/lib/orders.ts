import type { Depth, MarketInfo } from "../types";
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

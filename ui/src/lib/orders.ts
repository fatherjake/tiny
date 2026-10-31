import type { MarketInfo } from "../types";
import { bi } from "./scale";

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

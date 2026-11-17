import { bpsPct, type OrderPreview } from "../lib/orders";
import type { MarketInfo } from "../types";

export function baseAsset(market: MarketInfo | null): string {
  return market?.name.split("-")[0] ?? "";
}

export function orderToSend(
  pending: boolean,
  preview: OrderPreview,
): { size: bigint; price: bigint } | null {
  if (
    !pending &&
    !preview.problem &&
    preview.size != null &&
    preview.sendPrice != null
  ) {
    return { size: preview.size, price: preview.sendPrice };
  }
  return null;
}

export function feesLabel(market: MarketInfo | null): string {
  return market?.taker_fee_bps != null && market.maker_fee_bps != null
    ? bpsPct(market.taker_fee_bps) + " / " + bpsPct(market.maker_fee_bps)
    : "-";
}

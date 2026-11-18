import type { OpenOrder } from "../types";
import { mineKey } from "./Book.utils";

export function mineKeys(orders: OpenOrder[], market: string): Set<string> {
  return new Set(
    orders
      .filter((order) => order.market === market)
      .map((order) =>
        mineKey(order.side === "buy" ? "bid" : "ask", order.price),
      ),
  );
}

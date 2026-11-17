import type { OpenOrder, Trade } from "../types";
import { mineKey } from "./Book.utils";

export const PRINTS = 40;

export const latest = (rows: Trade[]) => rows.slice(0, PRINTS);

export function mineKeys(orders: OpenOrder[], market: string): Set<string> {
  return new Set(
    orders
      .filter((order) => order.market === market)
      .map((order) =>
        mineKey(order.side === "buy" ? "bid" : "ask", order.price),
      ),
  );
}

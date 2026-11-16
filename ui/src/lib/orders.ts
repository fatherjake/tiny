import type {
  AccountView,
  Depth,
  MarketInfo,
  OpenOrder,
  OrderDraft,
  Position,
  Scaled,
  StoredOrder,
} from "../types";
import { SCALE, bi, tryScaled } from "./scale";

const MARKET_SLIPPAGE_BPS = 100n;

export function marketPrice(
  side: "buy" | "sell",
  book: Depth | null,
): bigint | null {
  if (book == null) return null;
  const raw = side === "buy" ? book.best_ask : book.best_bid;
  if (raw == null) return null;
  const touch = bi(raw);
  if (touch <= 0n) return null;
  const band =
    side === "buy"
      ? 10_000n + MARKET_SLIPPAGE_BPS
      : 10_000n - MARKET_SLIPPAGE_BPS;
  const price = (touch * band) / 10_000n;
  return price > 0n ? price : null;
}

export function gridNote(
  market: MarketInfo | null,
  size: bigint | null,
  price: bigint | null,
  orderType: "limit" | "market",
): string {
  if (
    size != null &&
    market &&
    bi(market.lot_size) > 0n &&
    size % bi(market.lot_size) !== 0n
  ) {
    return "off lot";
  }
  if (
    orderType === "limit" &&
    price != null &&
    market &&
    bi(market.tick_size) > 0n
  ) {
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

export function midPrice(
  market: MarketInfo | null,
  book: Depth | null,
): bigint | null {
  if (market == null || book?.best_bid == null || book.best_ask == null)
    return null;
  const mid = (bi(book.best_bid) + bi(book.best_ask)) / 2n;
  const tick = bi(market.tick_size);
  const snapped = tick > 0n ? mid - (mid % tick) : mid;
  return snapped > 0n ? snapped : null;
}

export function sizeFromUsd(usd: bigint, price: bigint, lot: bigint): bigint {
  if (price <= 0n) return 0n;
  const size = (usd * SCALE) / price;
  return lot > 0n ? size - (size % lot) : size;
}

export function availableMargin(
  account: AccountView | null,
  markets: MarketInfo[],
  orders: OpenOrder[],
): bigint {
  if (account == null) return 0n;
  const lev = (name: string) =>
    BigInt(markets.find((m) => m.name === name)?.max_leverage || 1);
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

export type OrderPreview = {
  available: bigint;
  held: Scaled;
  mid: bigint | null;
  sendPrice: bigint | null;
  size: bigint | null;
  notional: bigint | null;
  requiredMargin: bigint | null;
  maxUsd: bigint | null;
  liquidation: bigint | null;
  problem: string;
  short: boolean;
};

export function previewOrder(
  form: OrderDraft,
  market: MarketInfo | null,
  markets: MarketInfo[],
  book: Depth | null,
  account: AccountView | null,
  orders: OpenOrder[],
): OrderPreview {
  const lev = Math.max(1, market?.max_leverage ?? 1);
  const available = availableMargin(account, markets, orders);
  const held = market ? (account?.positions?.[market.name]?.size ?? 0) : 0;
  const cap = form.type === "market" ? marketPrice(form.side, book) : null;
  const touch = form.side === "buy" ? book?.best_ask : book?.best_bid;
  const sendPrice = form.type === "limit" ? tryScaled(form.price) : cap;
  const sizePrice =
    form.type === "limit" ? sendPrice : touch == null ? null : bi(touch);
  const dollars = tryScaled(form.usd);
  const size =
    dollars != null && sizePrice != null && market
      ? sizeFromUsd(dollars, sizePrice, bi(market.lot_size))
      : null;
  const notional =
    size != null && sizePrice != null ? (size * sizePrice) / SCALE : null;
  const requiredMargin =
    size != null && sendPrice != null
      ? (size * sendPrice) / SCALE / BigInt(lev)
      : null;
  const maxUsd =
    sizePrice != null && sendPrice != null
      ? (available * BigInt(lev) * sizePrice) / sendPrice
      : null;
  const pos = market ? account?.positions?.[market.name] : undefined;
  let liquidation: bigint | null = null;
  if (market && size != null && size > 0n && sizePrice != null) {
    const fee = BigInt(
      (form.type === "market" ? market.taker_fee_bps : market.maker_fee_bps) ??
        0,
    );
    liquidation = liquidationPrice(
      afterFill(
        {
          collateral: bi(account?.collateral ?? 0),
          size: bi(pos?.size ?? 0),
          entry: bi(pos?.entry_notional ?? 0),
        },
        form.side === "buy" ? size : -size,
        sizePrice,
        fee,
      ),
      BigInt(market.maintenance_margin_bps),
    );
  }
  let problem = gridNote(market, null, sendPrice, form.type);
  if (!problem && form.type === "market" && cap == null) problem = "no quote";
  if (!problem && dollars == null) problem = "enter a size in USD";
  if (!problem && size === 0n) problem = "size is below one lot";
  const short =
    !problem &&
    !form.reduceOnly &&
    requiredMargin != null &&
    requiredMargin > available;
  if (short) problem = "margin";
  return {
    available,
    held,
    mid: midPrice(market, book),
    sendPrice,
    size,
    notional,
    requiredMargin,
    maxUsd,
    liquidation,
    problem,
    short,
  };
}

export type Holding = { collateral: bigint; size: bigint; entry: bigint };

export function afterFill(
  held: Holding,
  size: bigint,
  price: bigint,
  feeBps: bigint,
): Holding {
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
  const closedEntry =
    closed === abs(old) ? held.entry : (held.entry * closed) / abs(old);
  const closedNotional = (price * closed) / SCALE;
  collateral +=
    old > 0n ? closedNotional - closedEntry : closedEntry - closedNotional;
  if (next === 0n) return { collateral, size: 0n, entry: 0n };
  const entry = closing
    ? held.entry - closedEntry
    : (price * abs(next)) / SCALE;
  return { collateral, size: next, entry };
}

export function liquidationPrice(
  held: Holding,
  maintenanceBps: bigint,
): bigint | null {
  const { collateral, size, entry } = held;
  if (size === 0n) return null;
  const price =
    size > 0n
      ? ((entry - collateral) * SCALE * 10_000n) /
        (size * (10_000n - maintenanceBps))
      : ((collateral + entry) * SCALE * 10_000n) /
        (-size * (10_000n + maintenanceBps));
  return price > 0n ? price : null;
}

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

export function outcome(
  row: Pick<StoredOrder, "order_id" | "status" | "reason">,
): string {
  const head = "order " + row.order_id + " " + row.status;
  if (!row.reason) return head;
  return head + ": " + (REASONS[row.reason] ?? row.reason);
}

export type CloseOrder = { side: "buy" | "sell"; size: bigint; price: bigint };

export function closeOrder(
  pos: Position,
  book: Depth | null,
): CloseOrder | null {
  const size = bi(pos.size);
  if (size === 0n) return null;
  const side = size > 0n ? "sell" : "buy";
  const price = marketPrice(side, book);
  if (price == null) return null;
  return { side, size: size > 0n ? size : -size, price };
}

export function fillSide(
  fill: { taker: string; maker: string; side: "buy" | "sell" },
  trader: string,
): "buy" | "sell" {
  if (fill.taker === trader) return fill.side;
  return fill.side === "buy" ? "sell" : "buy";
}

export function positionValue(
  size: bigint,
  mark: Scaled | null | undefined,
): bigint | null {
  if (mark == null) return null;
  const abs = size < 0n ? -size : size;
  return (abs * bi(mark)) / SCALE;
}

export type PositionRisk = {
  liquidation: bigint | null;
  toLiquidation: bigint | null;
  margin: bigint;
};

export function positionRisk(
  size: bigint,
  entry: bigint,
  collateral: bigint,
  mark: Scaled | null | undefined,
  market: MarketInfo,
): PositionRisk {
  const liquidation = liquidationPrice(
    { collateral, size, entry },
    BigInt(market.maintenance_margin_bps),
  );
  const markPrice = mark == null ? null : bi(mark);
  const gap =
    liquidation == null || markPrice == null ? null : markPrice - liquidation;
  return {
    liquidation,
    toLiquidation: gap == null ? null : gap < 0n ? -gap : gap,
    margin: entry / BigInt(Math.max(1, market.max_leverage)),
  };
}

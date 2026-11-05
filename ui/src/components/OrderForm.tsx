import type { FormEvent } from "react";

import {
  afterFill,
  availableMargin,
  bpsPct,
  gridNote,
  liquidationPrice,
  marketPrice,
  midPrice,
  sizeFromUsd,
} from "../lib/orders";
import { SCALE, bi, tryScaled, unscale, usd } from "../lib/scale";
import type { AccountView, Depth, MarketInfo, OpenOrder, OrderDraft } from "../types";

type Props = {
  form: OrderDraft;
  patch: (part: Partial<OrderDraft>) => void;
  market: MarketInfo | null;
  markets: MarketInfo[];
  book: Depth | null;
  account: AccountView | null;
  orders: OpenOrder[];
  nonce: number;
  orderId: number;
  pending: boolean;
  note: string;
  bad: boolean;
  onSubmit: (size: bigint, price: bigint) => void;
};

export function OrderForm({
  form,
  patch,
  market,
  markets,
  book,
  account,
  orders,
  nonce,
  orderId,
  pending,
  note,
  bad,
  onSubmit,
}: Props) {
  const base = market?.name.split("-")[0] ?? "";
  // Fixed at the market's max for now: the chain margins every order there.
  const lev = Math.max(1, market?.max_leverage ?? 1);
  const available = availableMargin(account, markets, orders);
  const held = market ? account?.positions?.[market.name]?.size ?? 0 : 0;

  // A market order is capped past the touch but sized and margined at the touch.
  const cap = form.type === "market" ? marketPrice(form.side, book) : null;
  const touch = form.side === "buy" ? book?.best_ask : book?.best_bid;
  const sendPx = form.type === "limit" ? tryScaled(form.price) : cap;
  const sizePx = form.type === "limit" ? sendPx : touch == null ? null : bi(touch);
  const dollars = tryScaled(form.usd);
  const size =
    dollars != null && sizePx != null && market ? sizeFromUsd(dollars, sizePx, bi(market.lot_size)) : null;
  const notional = size != null && sizePx != null ? (size * sizePx) / SCALE : null;
  const needs = notional == null ? null : notional / BigInt(lev);

  // Liquidation if this order fills at the price it is sized at. A market order pays the
  // taker fee, a limit order is taken to rest and pay the maker fee. Other markets are left
  // out, which is exact while the sim has one.
  const pos = market ? account?.positions?.[market.name] : undefined;
  let liquidation: bigint | null = null;
  if (market && size != null && size > 0n && sizePx != null) {
    const fee = BigInt((form.type === "market" ? market.taker_fee_bps : market.maker_fee_bps) ?? 0);
    const after = afterFill(
      {
        collateral: bi(account?.collateral ?? 0),
        size: bi(pos?.size ?? 0),
        entry: bi(pos?.entry_notional ?? 0),
      },
      form.side === "buy" ? size : -size,
      sizePx,
      fee,
    );
    liquidation = liquidationPrice(after, BigInt(market.maintenance_margin_bps));
  }

  let problem = gridNote(market, null, sendPx, form.type);
  if (!problem && form.type === "market" && cap == null) problem = "no quote";
  if (!problem && dollars == null) problem = "enter a size in USD";
  if (!problem && size === 0n) problem = "size is below one lot";
  // Not enough margin blocks the order like any problem, but only the red margin row shows it.
  const short = !problem && !form.reduceOnly && needs != null && needs > available;
  if (short) problem = "margin";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending && !problem && size != null && sendPx != null) onSubmit(size, sendPx);
  };
  const mid = midPrice(market, book);
  return (
    <form className="pad" onSubmit={submit}>
      <div className="row">
        <button
          type="button"
          className={form.type === "market" ? "on" : ""}
          onClick={() => patch({ type: "market" })}
        >
          market
        </button>
        <button
          type="button"
          className={form.type === "limit" ? "on" : ""}
          onClick={() => patch({ type: "limit" })}
        >
          limit
        </button>
      </div>
      <div className="row">
        <button
          type="button"
          className={form.side === "buy" ? "on" : ""}
          onClick={() => patch({ side: "buy" })}
        >
          buy / long
        </button>
        <button
          type="button"
          className={form.side === "sell" ? "on" : ""}
          onClick={() => patch({ side: "sell" })}
        >
          sell / short
        </button>
      </div>
      <div className="row spread">
        <span>available to trade</span>
        <span>{usd(available)}</span>
      </div>
      <div className="row spread">
        <span>current position</span>
        <span>
          {unscale(held)} {base}
        </span>
      </div>
      {form.type === "limit" ? (
        <div className="row">
          <span>price (USD)</span>
          <input className="amount" value={form.price} onInput={(event) => patch({ price: event.currentTarget.value })} />
          <button
            type="button"
            disabled={mid == null}
            onClick={() => mid != null && patch({ price: unscale(mid) })}
          >
            mid
          </button>
        </div>
      ) : null}
      <div className="row">
        <span>size (USD)</span>
        <input className="amount" value={form.usd} onInput={(event) => patch({ usd: event.currentTarget.value })} />
        <button
          type="button"
          disabled={available === 0n}
          onClick={() => patch({ usd: unscale(available * BigInt(lev)) })}
        >
          max
        </button>
      </div>
      <div className="row">
        <label className="row">
          <input
            type="checkbox"
            checked={form.reduceOnly}
            onChange={(event) => patch({ reduceOnly: event.currentTarget.checked })}
          />
          reduce only
        </label>
      </div>
      <div className="row spread">
        <span>liquidation price</span>
        <span>{usd(liquidation)}</span>
      </div>
      <div className="row spread">
        <span>order size</span>
        <span>
          {size == null ? "-" : unscale(size)} {base}
        </span>
      </div>
      <div className="row spread">
        <span>order value</span>
        <span>{usd(notional)}</span>
      </div>
      <div className={short ? "row spread error" : "row spread"}>
        <span>margin required</span>
        <span>{usd(needs)}</span>
      </div>
      <div className="row spread">
        <span>fees</span>
        <span>
          {market?.taker_fee_bps != null && market.maker_fee_bps != null
            ? bpsPct(market.taker_fee_bps) + " / " + bpsPct(market.maker_fee_bps)
            : "-"}
        </span>
      </div>
      {problem && !short ? <div>{problem}</div> : null}
      <button type="submit" className="dark wide">
        {pending ? "Sending Order" : "Place Order"}
      </button>
      <div className="muted stamp">
        id {orderId} nonce {nonce}
      </div>
      {note ? <div className={bad ? "error" : ""}>{note}</div> : null}
    </form>
  );
}

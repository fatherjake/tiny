import type { FormEvent } from "react";

import { availableMargin, gridNote, marketPrice, midPrice, sizeFromUsd } from "../lib/orders";
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

  let problem = gridNote(market, null, sendPx, form.type);
  if (!problem && form.type === "market" && cap == null) problem = "no quote";
  if (!problem && dollars == null) problem = "enter a size in USD";
  if (!problem && size === 0n) problem = "size is below one lot";
  if (!problem && !form.reduceOnly && needs != null && needs > available) {
    problem = "needs " + usd(needs) + " margin at " + lev + "x, " + usd(available) + " available";
  }

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
          <input value={form.price} onInput={(event) => patch({ price: event.currentTarget.value })} />
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
        <input value={form.usd} onInput={(event) => patch({ usd: event.currentTarget.value })} />
        <button
          type="button"
          disabled={available === 0n}
          onClick={() => patch({ usd: unscale(available * BigInt(lev)) })}
        >
          max
        </button>
      </div>
      <div className="row spread">
        <span>leverage</span>
        <span>{lev}x cross, fixed</span>
      </div>
      <div className="row">
        <button
          type="button"
          className={form.reduceOnly ? "on" : ""}
          onClick={() => patch({ reduceOnly: !form.reduceOnly })}
        >
          reduce-only
        </button>
        <span>
          {size == null ? "-" : unscale(size)} {base} · margin {usd(needs)}
        </span>
      </div>
      {problem ? <div>{problem}</div> : null}
      <div className="row">
        <span>
          id {orderId} nonce {nonce}
        </span>
        <button type="submit">{pending ? "sending" : "place"}</button>
      </div>
      {note ? <div className={bad ? "error" : ""}>{note}</div> : null}
    </form>
  );
}

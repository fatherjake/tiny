import type { FormEvent } from "react";

import { gridNote, marketPrice } from "../lib/orders";
import { SCALE, bi, fmt, tryScaled } from "../lib/scale";
import type { Depth, MarketInfo, OrderDraft, Scaled } from "../types";

type Props = {
  form: OrderDraft;
  patch: (part: Partial<OrderDraft>) => void;
  market: MarketInfo | null;
  book: Depth | null;
  nonce: number;
  orderId: number;
  pending: boolean;
  note: string;
  bad: boolean;
  onSubmit: () => void;
};

export function OrderForm({
  form,
  patch,
  market,
  book,
  nonce,
  orderId,
  pending,
  note,
  bad,
  onSubmit,
}: Props) {
  const size = tryScaled(form.size);
  const cap = form.type === "market" ? marketPrice(form.side, book) : null;
  const limitPx = form.type === "limit" ? tryScaled(form.price) : cap;
  let touch: Scaled | null | undefined = null;
  if (form.type === "market" && book) {
    touch = form.side === "buy" ? book.best_ask : book.best_bid;
  }
  const notionalPx = form.type === "market" ? (touch == null ? null : bi(touch)) : limitPx;
  const notional = size != null && notionalPx != null ? (notionalPx * size) / SCALE : null;
  let problem = gridNote(market, size, limitPx, form.type);
  if (!problem && form.type === "market" && cap == null) problem = "no quote";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending && !problem) onSubmit();
  };
  return (
    <form className="pad" onSubmit={submit}>
      <div className="row">
        <button
          type="button"
          className={form.side === "buy" ? "on" : ""}
          onClick={() => patch({ side: "buy" })}
        >
          B buy
        </button>
        <button
          type="button"
          className={form.side === "sell" ? "on" : ""}
          onClick={() => patch({ side: "sell" })}
        >
          S sell
        </button>
        <button
          type="button"
          className={form.type === "limit" ? "on" : ""}
          onClick={() => patch({ type: "limit" })}
        >
          limit
        </button>
        <button
          type="button"
          className={form.type === "market" ? "on" : ""}
          onClick={() => patch({ type: "market" })}
        >
          market
        </button>
      </div>
      <div className="row">
        <span>size</span>
        <input value={form.size} onInput={(event) => patch({ size: event.currentTarget.value })} />
        {form.type === "limit" ? (
          <>
            <span>price</span>
            <input
              value={form.price}
              onInput={(event) => patch({ price: event.currentTarget.value })}
            />
          </>
        ) : (
          <>
            <span>{form.side === "buy" ? "max price" : "min price"}</span>
            <span>{fmt(cap)}</span>
          </>
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className={form.reduceOnly ? "on" : ""}
          onClick={() => patch({ reduceOnly: !form.reduceOnly })}
        >
          reduce-only
        </button>
        <span>notional {fmt(notional)}</span>
      </div>
      <div>
        int size {size == null ? "-" : size.toString()} price {limitPx == null ? "-" : limitPx.toString()}{" "}
        {problem}
      </div>
      <div className="row">
        <span>
          id {orderId} nonce {nonce}
        </span>
        <button type="submit">{pending ? "sending" : "place"}</button>
      </div>
      {note ? <div className={bad ? "on" : ""}>{note}</div> : null}
    </form>
  );
}

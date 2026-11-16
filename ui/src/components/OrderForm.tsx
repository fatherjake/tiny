import { type FormEvent, useEffect, useRef } from "react";

import { useBook, useMarket, useMarkets } from "../hooks/useMarket";
import { bpsPct, currentPrice, previewOrder } from "../lib/orders";
import { unscale, usd } from "../lib/scale";
import type { AccountView, OpenOrder, OrderDraft } from "../types";

type Props = {
  form: OrderDraft;
  patch: (part: Partial<OrderDraft>) => void;
  selected: string;
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
  selected,
  account,
  orders,
  nonce,
  orderId,
  pending,
  note,
  bad,
  onSubmit,
}: Props) {
  const market = useMarket(selected);
  const markets = useMarkets();
  const book = useBook(selected);
  const pricedFor = useRef("");
  const prefill = currentPrice(market);
  // Start the price at the market's current price, once per market.
  useEffect(() => {
    if (prefill == null || pricedFor.current === selected) return;
    pricedFor.current = selected;
    patch({ price: unscale(prefill) });
  }, [selected, prefill, patch]);
  const base = market?.name.split("-")[0] ?? "";
  const preview = previewOrder(form, market, markets, book, account, orders);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !pending &&
      !preview.problem &&
      preview.size != null &&
      preview.sendPrice != null
    ) {
      onSubmit(preview.size, preview.sendPrice);
    }
  };
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
        <span>{usd(preview.available)}</span>
      </div>
      <div className="row spread">
        <span>current position</span>
        <span>
          {unscale(preview.held)} {base}
        </span>
      </div>
      {form.type === "limit" ? (
        <div className="row">
          <span>price (USD)</span>
          <input
            className="amount"
            value={form.price}
            onInput={(event) => patch({ price: event.currentTarget.value })}
          />
          <button
            type="button"
            disabled={preview.mid == null}
            onClick={() =>
              preview.mid != null && patch({ price: unscale(preview.mid) })
            }
          >
            mid
          </button>
        </div>
      ) : null}
      <div className="row">
        <span>size (USD)</span>
        <input
          className="amount"
          value={form.usd}
          onInput={(event) => patch({ usd: event.currentTarget.value })}
        />
        <button
          type="button"
          disabled={preview.maxUsd == null || preview.maxUsd === 0n}
          onClick={() =>
            preview.maxUsd != null && patch({ usd: unscale(preview.maxUsd) })
          }
        >
          max
        </button>
      </div>
      <div className="row">
        <label className="row">
          <input
            type="checkbox"
            checked={form.reduceOnly}
            onChange={(event) =>
              patch({ reduceOnly: event.currentTarget.checked })
            }
          />
          reduce only
        </label>
      </div>
      <div className="row spread">
        <span>liquidation price</span>
        <span>{usd(preview.liquidation)}</span>
      </div>
      <div className="row spread">
        <span>order size</span>
        <span>
          {preview.size == null ? "-" : unscale(preview.size)} {base}
        </span>
      </div>
      <div className="row spread">
        <span>order value</span>
        <span>{usd(preview.notional)}</span>
      </div>
      <div className={preview.short ? "row spread error" : "row spread"}>
        <span>margin required</span>
        <span>{usd(preview.requiredMargin)}</span>
      </div>
      <div className="row spread">
        <span>fees</span>
        <span>
          {market?.taker_fee_bps != null && market.maker_fee_bps != null
            ? bpsPct(market.taker_fee_bps) +
              " / " +
              bpsPct(market.maker_fee_bps)
            : "-"}
        </span>
      </div>
      {preview.problem && !preview.short ? <div>{preview.problem}</div> : null}
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

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAccountSelect, useOrderHistory } from "./useAccount";
import { accountQuery } from "../lib/accountQueries";
import { TxError, signAndPost } from "../lib/api";
import { marketKeys } from "../lib/marketQueries";
import { closeOrder, outcome } from "../lib/orders";
import type { AccountView, Depth, OpenOrder, Position } from "../types";
import type { TraderKey } from "./useTraderSession";

const firstOrderId = () => Date.now() * 1000;
const message = (err: unknown) =>
  err instanceof Error ? err.message || String(err) : String(err);

const nonceOf = (account: AccountView | null) => account?.nonce ?? 0;

export function useOrderActions(key: TraderKey | null) {
  const client = useQueryClient();
  const trader = key?.trader ?? "";
  // Only the nonce, so a mark move that changes the account value does not
  // re-render whoever holds these actions.
  const accountNonce = useAccountSelect(trader, nonceOf) ?? 0;
  const history = useOrderHistory(trader);
  const refreshAccount = () =>
    trader ? client.fetchQuery(accountQuery(trader)) : Promise.resolve(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const localNonce = useRef(0);
  const nextId = useRef(firstOrderId());
  const awaiting = useRef<number | null>(null);
  useEffect(() => {
    localNonce.current = 0;
    awaiting.current = null;
    setNote("");
    setBad(false);
  }, [key]);
  useEffect(() => {
    const row = history.find((item) => item.order_id === awaiting.current);
    if (!row) return;
    awaiting.current = null;
    setBad(row.status === "rejected");
    setNote(outcome(row));
  }, [history]);
  const nonce = Math.max(localNonce.current, accountNonce) + 1;
  async function send(order: {
    market: string;
    side: "buy" | "sell";
    type: "limit" | "market";
    price: bigint;
    size: bigint;
    reduce_only: boolean;
  }) {
    if (!key || pending) return;
    setPending(true);
    const sentNonce = Math.max(localNonce.current, accountNonce) + 1;
    const id = nextId.current;
    try {
      await signAndPost(
        key.secret,
        { kind: "place_order", order: { id, trader: key.trader, ...order } },
        sentNonce,
      );
      localNonce.current = sentNonce;
      nextId.current = id + 1;
      awaiting.current = id;
      setBad(false);
      setNote("order " + id + " sent, waiting for a block");
    } catch (err) {
      if (err instanceof TxError && err.status === 400) {
        const fresh = await refreshAccount();
        if (fresh)
          localNonce.current = Math.max(localNonce.current, fresh.nonce);
      }
      setBad(true);
      setNote(message(err));
    } finally {
      setPending(false);
    }
  }
  async function cancel(order: OpenOrder) {
    if (!key || pending) return;
    setPending(true);
    const sentNonce = Math.max(localNonce.current, accountNonce) + 1;
    try {
      await signAndPost(
        key.secret,
        {
          kind: "cancel_order",
          trader: key.trader,
          market: order.market,
          order_id: order.id,
        },
        sentNonce,
      );
      localNonce.current = sentNonce;
      setBad(false);
      setNote("accepted nonce " + sentNonce);
    } catch (err) {
      setBad(true);
      setNote(message(err));
    } finally {
      setPending(false);
    }
  }
  async function close(pos: Position) {
    // Read at click time, so placing orders does not subscribe to every book frame.
    const books = client.getQueryData<Record<string, Depth>>(marketKeys.books);
    const order = closeOrder(pos, books?.[pos.market] ?? null);
    if (!order) {
      setBad(true);
      setNote("no quote to close " + pos.market + " against");
      return;
    }
    await send({
      market: pos.market,
      type: "market",
      reduce_only: true,
      ...order,
    });
  }
  return {
    pending,
    note,
    bad,
    nonce,
    orderId: nextId.current,
    send,
    cancel,
    close,
  };
}

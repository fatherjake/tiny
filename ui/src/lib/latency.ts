import { queryOptions } from "@tanstack/react-query";

import type { BlockTx } from "../types";

const sent = new Map<string, number>();

const id = (signer: string, nonce: number) => signer + ":" + nonce;

export function markSent(signer: string, nonce: number): void {
  sent.set(id(signer, nonce), performance.now());
}

export function forgetSent(signer: string, nonce: number): void {
  sent.delete(id(signer, nonce));
}

export function inclusionMs(txs: BlockTx[]): number | null {
  let ms: number | null = null;
  for (const tx of txs) {
    const at = sent.get(id(tx.signer, tx.nonce));
    if (at == null) continue;
    sent.delete(id(tx.signer, tx.nonce));
    ms = Math.round(performance.now() - at);
  }
  return ms;
}

const local = <T>(key: string) =>
  queryOptions({
    queryKey: ["stream", key] as const,
    queryFn: (): T | null => null,
    initialData: null as T | null,
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const lastBlockQuery = local<number>("lastBlock");
export const inclusionQuery = local<number>("inclusion");

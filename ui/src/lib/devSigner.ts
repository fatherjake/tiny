import * as ed from "@noble/ed25519";

import { memorySigner, type Signer, traderOf } from "./keystore";

export async function devSigner(
  hex: string | undefined,
): Promise<Signer | null> {
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("VITE_DEV_SEED must be 64 hex characters");
  }
  const seed = ed.etc.hexToBytes(hex);
  return memorySigner(seed, await traderOf(seed));
}

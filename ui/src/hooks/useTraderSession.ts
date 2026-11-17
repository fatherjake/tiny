import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { devSigner } from "../lib/devSigner";
import { loadSigner, type Signer, unlock } from "../lib/keystore";
import { keyFromSignature, keyMessage } from "../lib/wallet";

export type TraderKey = Signer;

function message(err: unknown): string {
  return err instanceof Error ? err.message || String(err) : String(err);
}

export function useTraderSession() {
  const { address: wallet, status } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [key, setKey] = useState<TraderKey | null>(null);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState(false);
  const token = useRef(0);

  useEffect(() => {
    const current = ++token.current;
    setKey(null);
    setError("");
    setSigning(false);
    const seed = import.meta.env.DEV ? import.meta.env.VITE_DEV_SEED : "";
    if (seed) {
      devSigner(seed).then(
        (signer) => {
          if (current === token.current) setKey(signer);
        },
        (err: unknown) => {
          if (current === token.current) setError(message(err));
        },
      );
      return;
    }
    if (!wallet) return;
    void loadSigner(wallet).then((stored) => {
      if (stored && current === token.current) setKey(stored);
    });
  }, [wallet]);

  async function enable() {
    if (!wallet) return;
    const current = ++token.current;
    setKey(null);
    setError("");
    setSigning(true);
    try {
      const signature = await signMessageAsync({ message: keyMessage(wallet) });
      const seed = await keyFromSignature(signature);
      const signer = await unlock(wallet, seed);
      seed.fill(0);
      if (current === token.current) setKey(signer);
    } catch (err) {
      if (current === token.current) setError(message(err).split("\n")[0]);
    } finally {
      if (current === token.current) setSigning(false);
    }
  }

  return {
    wallet,
    key,
    error,
    signing,
    canSign: status === "connected" && !signing,
    enable,
  };
}

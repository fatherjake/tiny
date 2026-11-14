import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { publicHex } from "../lib/api";
import { keyFromSignature, keyMessage } from "../lib/wallet";

export type TraderKey = { secret: Uint8Array; trader: string };

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
  const signedFor = useRef<string | null>(null);

  useEffect(() => {
    if (signedFor.current === null || signedFor.current === wallet) return;
    signedFor.current = null;
    token.current++;
    setKey(null);
    setError("");
    setSigning(false);
  }, [wallet]);

  async function enable() {
    if (!wallet) return;
    signedFor.current = wallet;
    const current = ++token.current;
    setKey(null);
    setError("");
    setSigning(true);
    try {
      const signature = await signMessageAsync({ message: keyMessage(wallet) });
      const secret = await keyFromSignature(signature);
      const trader = await publicHex(secret);
      if (current === token.current) setKey({ secret, trader });
    } catch (err) {
      if (current === token.current) {
        signedFor.current = null;
        setError(message(err).split("\n")[0]);
      }
    } finally {
      if (current === token.current) setSigning(false);
    }
  }

  return { wallet, key, error, signing, canSign: status === "connected" && !signing, enable };
}

import * as ed from "@noble/ed25519";

// A wallet signs this once and the signature's hash becomes the tiny trading key, so the
// same wallet always opens the same account. Changing the text changes every derived key.
export function keyMessage(address: string): string {
  return [
    "tiny trading key",
    "",
    "Sign to create the tiny trading key for this wallet.",
    "Anyone holding this signature can trade as you on tiny, so only sign it on tiny.",
    "",
    "wallet: " + address.toLowerCase(),
    "version: 1",
  ].join("\n");
}

export async function keyFromSignature(signature: string): Promise<Uint8Array> {
  const bytes = ed.etc.hexToBytes(signature.replace(/^0x/, ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

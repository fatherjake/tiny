import * as ed from "@noble/ed25519";

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

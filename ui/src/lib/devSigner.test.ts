import { createPrivateKey, createPublicKey, verify } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { devSigner } from "./devSigner";

const SEED = "00".repeat(31) + "2a";
const TRADER =
  "c561fa9f643fe5c60113cce9db282fde2b9e5ca5fc6b6fc0d1679bb339c9f72f";

function nodeKeys(hex: string) {
  const priv = createPrivateKey({
    key: Buffer.from("302e020100300506032b657004220420" + hex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return { priv, pub: createPublicKey(priv) };
}

describe("devSigner", () => {
  it("has no signer without a seed", async () => {
    expect(await devSigner(undefined)).toBe(null);
    expect(await devSigner("")).toBe(null);
  });

  it("rejects a seed that is not 32 bytes of hex", async () => {
    for (const bad of ["2a", "zz".repeat(32), "00".repeat(33), "0x" + SEED]) {
      await expect(devSigner(bad)).rejects.toThrow(
        "VITE_DEV_SEED must be 64 hex characters",
      );
    }
  });

  it("trades as the seed's public key and signs verifiably", async () => {
    const signer = await devSigner(SEED);
    expect(signer?.trader).toBe(TRADER);
    const payload = new TextEncoder().encode("order");
    const sig = await signer!.sign(payload);
    expect(
      verify(null, Buffer.from(payload), nodeKeys(SEED).pub, Buffer.from(sig)),
    ).toBe(true);
  });

  it("accepts upper case hex as the same key", async () => {
    expect((await devSigner(SEED.toUpperCase()))?.trader).toBe(TRADER);
  });

  it("matches node's ed25519 for any seed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ maxLength: 64 }),
        async (bytes, payload) => {
          const hex = Buffer.from(bytes).toString("hex");
          const { priv, pub } = nodeKeys(hex);
          const signer = await devSigner(hex);
          const expected = createPublicKey(priv)
            .export({ format: "der", type: "spki" })
            .subarray(12)
            .toString("hex");
          expect(signer?.trader).toBe(expected);
          const sig = await signer!.sign(payload);
          expect(
            verify(null, Buffer.from(payload), pub, Buffer.from(sig)),
          ).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});

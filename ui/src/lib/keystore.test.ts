import * as ed from "@noble/ed25519";
import { describe, expect, it } from "vitest";

import { cryptoSigner, lockedKey, memorySigner, traderOf } from "./keystore";

const seed = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const payload = new TextEncoder().encode('[{"kind":"place_order"},"ab",1]');

describe("locked trading key", () => {
  it("signs exactly what the noble key signs, so the chain still verifies it", async () => {
    const key = await lockedKey(seed());
    const trader = await traderOf(seed());
    const locked = await cryptoSigner(key, trader).sign(payload);
    expect(ed.etc.bytesToHex(locked)).toBe(
      ed.etc.bytesToHex(await ed.signAsync(payload, seed())),
    );
    expect(
      await ed.verifyAsync(locked, payload, ed.etc.hexToBytes(trader)),
    ).toBe(true);
  });

  it("cannot be exported, even by the page that made it", async () => {
    const key = await lockedKey(seed());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow();
  });

  it("falls back to the same signature when kept in memory", async () => {
    const trader = await traderOf(seed());
    const sig = await memorySigner(seed(), trader).sign(payload);
    expect(ed.etc.bytesToHex(sig)).toBe(
      ed.etc.bytesToHex(await ed.signAsync(payload, seed())),
    );
  });
});

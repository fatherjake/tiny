import * as ed from "@noble/ed25519";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cryptoSigner,
  loadSigner,
  lockedKey,
  memorySigner,
  saveSigner,
  traderOf,
  unlock,
} from "./keystore";

const seed = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const payload = new TextEncoder().encode('[{"kind":"place_order"},"ab",1]');
const TRADER =
  "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";

type Failure = "none" | "open" | "request";

type FakeRequest = {
  result?: unknown;
  error?: Error;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
};

function fakeIndexedDB(fail: Failure = "none") {
  const stores = new Map<string, Map<string, unknown>>();
  let version = 0;
  const settle = (req: FakeRequest, ok: () => unknown) => {
    setTimeout(() => {
      if (fail === "request") {
        req.error = new Error("quota exceeded");
        req.onerror?.();
        return;
      }
      req.result = ok();
      req.onsuccess?.();
    });
    return req;
  };
  const db = {
    createObjectStore: (name: string) => stores.set(name, new Map()),
    transaction: (name: string, mode: string) => ({
      objectStore: () => {
        const rows = stores.get(name) as Map<string, unknown>;
        return {
          get: (key: string) => settle({}, () => rows.get(key)),
          put: (value: unknown, key: string) =>
            settle({}, () => {
              if (mode !== "readwrite") throw new Error("read only");
              rows.set(key, value);
              return key;
            }),
        };
      },
    }),
    close: () => {},
  };
  return {
    open: (_name: string, wanted: number) => {
      const req: FakeRequest = {};
      setTimeout(() => {
        if (fail === "open") {
          req.error = new Error("blocked");
          req.onerror?.();
          return;
        }
        req.result = db;
        if (version < wanted) {
          version = wanted;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const verify = async (sig: Uint8Array, trader: string) =>
  ed.verifyAsync(sig, payload, ed.etc.hexToBytes(trader));

describe("locked trading key", () => {
  it("signs exactly what the noble key signs, so the chain still verifies it", async () => {
    const key = await lockedKey(seed());
    const trader = await traderOf(seed());
    expect(trader).toBe(TRADER);
    const locked = await cryptoSigner(key, trader).sign(payload);
    expect(ed.etc.bytesToHex(locked)).toBe(
      ed.etc.bytesToHex(await ed.signAsync(payload, seed())),
    );
    expect(await verify(locked, trader)).toBe(true);
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

  it("keeps signing with the seed it was given, even if the caller wipes it", async () => {
    const mine = seed();
    const signer = memorySigner(mine, TRADER);
    mine.fill(0);
    expect(await verify(await signer.sign(payload), TRADER)).toBe(true);
  });
});

describe("stored trading key", () => {
  it("unlocks once and loads the same signer later, whatever the wallet case", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    const unlocked = await unlock("0xAbC", seed());
    expect(unlocked.trader).toBe(TRADER);
    expect(await loadSigner("0xdef")).toBe(null);
    const loaded = await loadSigner("0xABC");
    expect(loaded?.trader).toBe(TRADER);
    expect(
      await verify(
        await (loaded as NonNullable<typeof loaded>).sign(payload),
        TRADER,
      ),
    ).toBe(true);
  });

  it("keeps one key per wallet", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    const other = Uint8Array.from({ length: 32 }, (_, i) => 32 - i);
    await saveSigner("0xa", await lockedKey(seed()), TRADER);
    await saveSigner("0xb", await lockedKey(other), await traderOf(other));
    expect((await loadSigner("0xa"))?.trader).toBe(TRADER);
    expect((await loadSigner("0xb"))?.trader).toBe(await traderOf(other));
  });

  it("loads nothing when the database will not open", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB("open"));
    expect(await loadSigner("0xabc")).toBe(null);
  });

  it("reports a failed save", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB("request"));
    await expect(
      saveSigner("0xabc", await lockedKey(seed()), TRADER),
    ).rejects.toThrow("quota exceeded");
    expect(await loadSigner("0xabc")).toBe(null);
  });

  it("still unlocks a working signer when the key cannot be stored", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const signer = await unlock("0xabc", seed());
    expect(signer.trader).toBe(TRADER);
    expect(await verify(await signer.sign(payload), TRADER)).toBe(true);
    expect(await loadSigner("0xabc")).toBe(null);
  });

  it("signs from memory when the browser cannot lock the key", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(
      new Error("no Ed25519"),
    );
    const signer = await unlock("0xabc", seed());
    expect(signer.trader).toBe(TRADER);
    expect(ed.etc.bytesToHex(await signer.sign(payload))).toBe(
      ed.etc.bytesToHex(await ed.signAsync(payload, seed())),
    );
    expect(await loadSigner("0xabc")).toBe(null);
  });
});

describe("keystore properties", () => {
  it("signs like noble for any seed and payload, locked or in memory", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ maxLength: 64 }),
        async (secret, message) => {
          const trader = await traderOf(secret);
          expect(trader).toBe(
            ed.etc.bytesToHex(await ed.getPublicKeyAsync(secret)),
          );
          const expected = ed.etc.bytesToHex(
            await ed.signAsync(message, secret),
          );
          const locked = cryptoSigner(await lockedKey(secret), trader);
          expect(ed.etc.bytesToHex(await locked.sign(message))).toBe(expected);
          expect(
            ed.etc.bytesToHex(await memorySigner(secret, trader).sign(message)),
          ).toBe(expected);
        },
      ),
      { numRuns: 30 },
    );
  });
});

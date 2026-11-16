import * as ed from "@noble/ed25519";

import { bytesToHex } from "./encode";

export type Signer = {
  trader: string;
  sign: (payload: Uint8Array) => Promise<Uint8Array>;
};

type Stored = { key: CryptoKey; trader: string };

const PKCS8_ED25519 = ed.etc.hexToBytes("302e020100300506032b657004220420");
const DB = "tiny";
const STORE = "trading-keys";

export async function lockedKey(seed: Uint8Array): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_ED25519.length + seed.length);
  pkcs8.set(PKCS8_ED25519);
  pkcs8.set(seed, PKCS8_ED25519.length);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } finally {
    pkcs8.fill(0);
  }
}

export function cryptoSigner(key: CryptoKey, trader: string): Signer {
  return {
    trader,
    sign: async (payload) =>
      new Uint8Array(
        await crypto.subtle.sign("Ed25519", key, new Uint8Array(payload)),
      ),
  };
}

export function memorySigner(seed: Uint8Array, trader: string): Signer {
  const secret = seed.slice();
  return { trader, sign: (payload) => ed.signAsync(payload, secret) };
}

export async function traderOf(seed: Uint8Array): Promise<string> {
  return bytesToHex(await ed.getPublicKeyAsync(seed));
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const slot = (wallet: string) => wallet.toLowerCase();

export async function loadSigner(wallet: string): Promise<Signer | null> {
  try {
    const stored = await run<Stored | undefined>("readonly", (store) =>
      store.get(slot(wallet)),
    );
    return stored ? cryptoSigner(stored.key, stored.trader) : null;
  } catch {
    return null;
  }
}

export async function saveSigner(
  wallet: string,
  key: CryptoKey,
  trader: string,
): Promise<void> {
  const stored: Stored = { key, trader };
  await run("readwrite", (store) => store.put(stored, slot(wallet)));
}

export async function unlock(
  wallet: string,
  seed: Uint8Array,
): Promise<Signer> {
  const trader = await traderOf(seed);
  try {
    const key = await lockedKey(seed);
    await saveSigner(wallet, key, trader).catch(() => {});
    return cryptoSigner(key, trader);
  } catch {
    return memorySigner(seed, trader);
  }
}

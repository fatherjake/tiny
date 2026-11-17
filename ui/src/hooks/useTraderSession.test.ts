import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Signer } from "../lib/keystore";
import { useTraderSession } from "./useTraderSession";

const wagmi = vi.hoisted(() => ({
  address: undefined as string | undefined,
  status: "disconnected",
  signed: [] as string[],
  sign: (_: { message: string }): Promise<string> =>
    Promise.reject(new Error("unset")),
}));

const store = vi.hoisted(() => ({
  load: (_: string): Promise<Signer | null> => Promise.resolve(null),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wagmi.address, status: wagmi.status }),
  useSignMessage: () => ({
    signMessageAsync: (args: { message: string }) => {
      wagmi.signed.push(args.message);
      return wagmi.sign(args);
    },
  }),
}));

vi.mock("../lib/keystore", async (original) => ({
  ...(await original<typeof import("../lib/keystore")>()),
  loadSigner: (wallet: string) => store.load(wallet),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SIG_A = "0x" + "11".repeat(65);
const SIG_B = "0x" + "22".repeat(65);
const TRADER_A =
  "3b8f1ff22f3f069ba78a81e95c9a1006fbd56178e36c940c7d43d89475435e84";
const TRADER_B =
  "a3c29b76dc65a992df53f7f222ef28f149790fbabf49e76d35b011b77d5fc2f3";

function connect(address: string, status = "connected") {
  wagmi.address = address;
  wagmi.status = status;
}

beforeEach(() => {
  wagmi.address = undefined;
  wagmi.status = "disconnected";
  wagmi.signed = [];
  store.load = () => Promise.resolve(null);
});

afterEach(cleanup);

const session = () => renderHook(() => useTraderSession());

const fakeSigner = (trader: string): Signer => ({
  trader,
  sign: async () => new Uint8Array(64),
});

describe("useTraderSession", () => {
  it("does nothing without a wallet", async () => {
    const { result } = session();
    await act(() => result.current.enable());
    expect(result.current).toMatchObject({
      wallet: undefined,
      key: null,
      error: "",
      signing: false,
      canSign: false,
    });
    expect(wagmi.signed).toEqual([]);
  });

  it("restores the trading key stored for the wallet", async () => {
    connect("0xAbC");
    store.load = async (wallet) =>
      wallet === "0xAbC" ? fakeSigner("stored") : null;
    const { result } = session();
    await waitFor(() => expect(result.current.key?.trader).toBe("stored"));
    expect(result.current.wallet).toBe("0xAbC");
    expect(result.current.canSign).toBe(true);
  });

  it("stays locked when nothing is stored for the wallet", async () => {
    connect("0xAbC");
    const load = deferred<Signer | null>();
    store.load = () => load.promise;
    const { result } = session();
    await act(async () => load.resolve(null));
    expect(result.current.key).toBe(null);
    expect(result.current.canSign).toBe(true);
  });

  it("derives the trading key from the wallet's signature", async () => {
    connect("0xAbC");
    const sig = deferred<string>();
    wagmi.sign = () => sig.promise;
    const { result } = session();
    let done!: Promise<void>;
    act(() => {
      done = result.current.enable();
    });
    expect(result.current.signing).toBe(true);
    expect(result.current.canSign).toBe(false);
    expect(wagmi.signed).toEqual([
      "tiny trading key\n\nSign to create the tiny trading key for this wallet.\nAnyone holding this signature can trade as you on tiny, so only sign it on tiny.\n\nwallet: 0xabc\nversion: 1",
    ]);
    await act(async () => {
      sig.resolve(SIG_A);
      await done;
    });
    expect(result.current.key?.trader).toBe(TRADER_A);
    expect(result.current.signing).toBe(false);
    expect(result.current.canSign).toBe(true);
  });

  it("cannot sign while the wallet is still connecting", () => {
    connect("0xAbC", "connecting");
    const { result } = session();
    expect(result.current.canSign).toBe(false);
  });

  it.each([
    [
      new Error("User rejected the request.\n\nDetails: denied"),
      "User rejected the request.",
    ],
    [new Error(""), "Error"],
    ["plain refusal", "plain refusal"],
  ])("shows the first line of a failed signature (%s)", async (err, shown) => {
    connect("0xAbC");
    wagmi.sign = () => Promise.reject(err);
    const { result } = session();
    await act(() => result.current.enable());
    expect(result.current.error).toBe(shown);
    expect(result.current.key).toBe(null);
    expect(result.current.signing).toBe(false);
  });

  it("clears a previous error when signing again", async () => {
    connect("0xAbC");
    wagmi.sign = () => Promise.reject(new Error("no"));
    const { result } = session();
    await act(() => result.current.enable());
    expect(result.current.error).toBe("no");
    wagmi.sign = () => Promise.resolve(SIG_B);
    await act(() => result.current.enable());
    expect(result.current.error).toBe("");
    expect(result.current.key?.trader).toBe(TRADER_B);
  });

  it("drops a signature that lands after the wallet changed", async () => {
    connect("0xAAA");
    const first = deferred<string>();
    const second = deferred<string>();
    wagmi.sign = () => first.promise;
    const { result, rerender } = session();
    let late!: Promise<void>;
    act(() => {
      late = result.current.enable();
    });
    connect("0xBBB");
    rerender();
    expect(result.current).toMatchObject({
      wallet: "0xBBB",
      key: null,
      signing: false,
    });
    wagmi.sign = () => second.promise;
    let current!: Promise<void>;
    act(() => {
      current = result.current.enable();
    });
    await act(async () => {
      first.resolve(SIG_A);
      await late;
    });
    expect(result.current.key).toBe(null);
    expect(result.current.signing).toBe(true);
    await act(async () => {
      second.resolve(SIG_B);
      await current;
    });
    expect(result.current.key?.trader).toBe(TRADER_B);
    expect(result.current.signing).toBe(false);
  });

  it("drops a failure that lands after the wallet changed", async () => {
    connect("0xAAA");
    const first = deferred<string>();
    wagmi.sign = () => first.promise;
    const { result, rerender } = session();
    let late!: Promise<void>;
    act(() => {
      late = result.current.enable();
    });
    connect("0xBBB");
    rerender();
    wagmi.sign = () => new Promise(() => {});
    act(() => {
      void result.current.enable();
    });
    await act(async () => {
      first.reject(new Error("too late"));
      await late;
    });
    expect(result.current.error).toBe("");
    expect(result.current.signing).toBe(true);
  });

  it("ignores a stored key that loads after the wallet changed", async () => {
    connect("0xAAA");
    const slow = deferred<Signer | null>();
    store.load = (wallet) =>
      wallet === "0xAAA" ? slow.promise : Promise.resolve(null);
    const { result, rerender } = session();
    connect("0xBBB");
    rerender();
    await act(async () => slow.resolve(fakeSigner("stale")));
    expect(result.current.wallet).toBe("0xBBB");
    expect(result.current.key).toBe(null);
  });

  it("forgets the key when the wallet disconnects", async () => {
    connect("0xAbC");
    store.load = async () => fakeSigner("stored");
    const { result, rerender } = session();
    await waitFor(() => expect(result.current.key?.trader).toBe("stored"));
    wagmi.address = undefined;
    wagmi.status = "disconnected";
    rerender();
    expect(result.current.key).toBe(null);
    expect(result.current.canSign).toBe(false);
  });
});

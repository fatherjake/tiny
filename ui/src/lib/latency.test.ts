import { QueryClient } from "@tanstack/react-query";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetSent,
  inclusionMs,
  inclusionQuery,
  lastBlockQuery,
  markSent,
} from "./latency";

const tx = (signer: string, nonce: number) => ({
  kind: "place_order",
  signer,
  nonce,
});

const clock = (now: number) =>
  vi.spyOn(performance, "now").mockReturnValue(now);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inclusionMs", () => {
  it("times a sent tx once, when a block carries it", () => {
    clock(1_000);
    markSent("aa", 7);
    clock(1_250.4);
    expect(inclusionMs([tx("bb", 1), tx("aa", 7)])).toBe(250);
    expect(inclusionMs([tx("aa", 7)])).toBeNull();
  });

  it("ignores txs it did not send and ones it forgot", () => {
    markSent("aa", 8);
    forgetSent("aa", 8);
    expect(inclusionMs([tx("aa", 8), tx("cc", 1)])).toBeNull();
    markSent("aa", 9);
    expect(inclusionMs([tx("aa", 9)])).not.toBeNull();
  });

  it("reports the last of several sent txs in one block", () => {
    clock(100);
    markSent("aa", 1);
    clock(300);
    markSent("aa", 2);
    clock(1_000);
    expect(inclusionMs([tx("aa", 2), tx("aa", 1)])).toBe(900);
  });

  it("keys a tx by signer and nonce together", () => {
    clock(0);
    markSent("a", 11);
    clock(5);
    expect(inclusionMs([tx("a1", 1), tx("a", 1)])).toBeNull();
    expect(inclusionMs([tx("a", 11)])).toBe(5);
  });

  it("times each sent tx exactly once, whatever order blocks arrive in", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(1000), { minLength: 1, maxLength: 10 }),
        fc.nat(10_000),
        (nonces, elapsed) => {
          clock(0);
          for (const nonce of nonces) markSent("prop", nonce);
          clock(elapsed);
          const timed = nonces.map((nonce) => inclusionMs([tx("prop", nonce)]));
          expect(timed).toEqual(nonces.map(() => elapsed));
          expect(
            inclusionMs(nonces.map((nonce) => tx("prop", nonce))),
          ).toBeNull();
        },
      ),
    );
  });
});

describe("stream queries", () => {
  it("start empty, hold what the stream writes, and never fetch on their own", async () => {
    const client = new QueryClient();
    expect(await client.fetchQuery(lastBlockQuery)).toBeNull();
    client.setQueryData(lastBlockQuery.queryKey, 1_700_000_000_000);
    client.setQueryData(inclusionQuery.queryKey, 42);
    expect(await client.fetchQuery(lastBlockQuery)).toBe(1_700_000_000_000);
    expect(await client.fetchQuery(inclusionQuery)).toBe(42);
  });

  it("reset to empty when forced to refetch", async () => {
    const client = new QueryClient();
    await client.fetchQuery(inclusionQuery);
    await client.fetchQuery(lastBlockQuery);
    client.setQueryData(inclusionQuery.queryKey, 42);
    client.setQueryData(lastBlockQuery.queryKey, 7);
    await client.refetchQueries({ queryKey: ["stream"] });
    expect(client.getQueryData(inclusionQuery.queryKey)).toBeNull();
    expect(client.getQueryData(lastBlockQuery.queryKey)).toBeNull();
  });
});

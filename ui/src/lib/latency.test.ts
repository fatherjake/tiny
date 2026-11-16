import { describe, expect, it } from "vitest";

import { forgetSent, inclusionMs, markSent } from "./latency";

const tx = (signer: string, nonce: number) => ({
  kind: "place_order",
  signer,
  nonce,
});

describe("inclusionMs", () => {
  it("times a sent tx once, when a block carries it", () => {
    markSent("aa", 7);
    const ms = inclusionMs([tx("bb", 1), tx("aa", 7)]);
    expect(ms).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(inclusionMs([tx("aa", 7)])).toBeNull();
  });

  it("ignores txs it did not send and ones it forgot", () => {
    markSent("aa", 8);
    forgetSent("aa", 8);
    expect(inclusionMs([tx("aa", 8), tx("cc", 1)])).toBeNull();
  });
});

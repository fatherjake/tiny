import { describe, expect, it } from "vitest";

import { canonicalize, type Canon } from "./encode";

describe("canonicalize", () => {
  it("matches the place-order bytes core.types.encode emits", () => {
    const body: Canon = {
      kind: "place_order",
      order: {
        id: 1,
        trader: "alice",
        market: "BTC-PERP",
        side: "buy",
        type: "limit",
        price: 60_000_000_000,
        size: 1_000_000,
        reduce_only: false,
      },
    };
    expect(canonicalize(body)).toBe(
      '{"kind":"place_order","order":{"id":1,"market":"BTC-PERP","price":60000000000,"reduce_only":false,"side":"buy","size":1000000,"trader":"alice","type":"limit"}}',
    );
  });

  it("escapes quotes and backslashes the way the chain does", () => {
    const body: Canon = {
      kind: "cancel_order",
      trader: 'a"b\\c',
      market: "BTC-PERP",
      order_id: 7,
    };
    expect(canonicalize(body)).toBe(
      '{"kind":"cancel_order","market":"BTC-PERP","order_id":7,"trader":"a\\"b\\\\c"}',
    );
  });

  it("writes bigints and signature bytes the way the chain does", () => {
    const body: Canon = {
      kind: "set_oracle_price",
      price: {
        market: "BTC-PERP",
        price: 2n ** 60n,
        sigs: { 10: new Uint8Array([0xff]), 2: new Uint8Array([0x00]) },
        timestamp_ms: 2,
      },
    };
    expect(canonicalize(body)).toBe(
      '{"kind":"set_oracle_price","price":{"market":"BTC-PERP","price":1152921504606846976,"sigs":{"10":"ff","2":"00"},"timestamp_ms":2}}',
    );
  });
});

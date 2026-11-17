import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesToHex, canonicalize, type Canon } from "./encode";

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

describe("canonicalize scalars", () => {
  it("writes null, booleans and integers, with negative zero as zero", () => {
    expect(canonicalize([null, true, false, -0, -42, 0n, -7n])).toBe(
      "[null,true,false,0,-42,0,-7]",
    );
  });

  it("refuses floats and unsafe integers", () => {
    expect(() => canonicalize(1.5)).toThrow("encode refuses floats");
    expect(() => canonicalize(2 ** 53)).toThrow("use bigint above 2^53");
    expect(canonicalize(2 ** 53 - 1)).toBe("9007199254740991");
  });

  it("refuses values outside the canonical types", () => {
    expect(() => canonicalize(undefined as unknown as Canon)).toThrow(
      "cannot encode undefined",
    );
    expect(() => canonicalize((() => 1) as unknown as Canon)).toThrow(
      "cannot encode function",
    );
  });

  it("escapes control characters and writes non-ascii as utf-16 escapes", () => {
    expect(canonicalize("\b\f\n\r\t\u0001\u007f~ é😀")).toBe(
      '"\\b\\f\\n\\r\\t\\u0001\\u007f~ \\u00e9\\ud83d\\ude00"',
    );
  });

  it("writes empty containers and nested arrays", () => {
    expect(
      canonicalize({ a: [], b: {}, c: [[1], new Uint8Array([1, 171])] }),
    ).toBe('{"a":[],"b":{},"c":[[1],"01ab"]}');
  });
});

describe("bytesToHex", () => {
  it("pads each byte to two lowercase digits", () => {
    expect(bytesToHex([0, 10, 255])).toBe("000aff");
    expect(bytesToHex([])).toBe("");
  });

  it("matches node's hex encoding for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        expect(bytesToHex(bytes)).toBe(Buffer.from(bytes).toString("hex"));
      }),
    );
  });
});

const safeKey = fc.string().filter((key) => key !== "__proto__");

const { json } = fc.letrec<{ json: Canon }>((tie) => ({
  json: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.maxSafeInteger().map((n) => n + 0),
    fc.string({ unit: "binary" }),
    fc.array(tie("json"), { maxLength: 4 }),
    fc.dictionary(safeKey, tie("json"), { maxKeys: 4 }),
  ),
}));

describe("canonicalize properties", () => {
  it("emits ascii JSON that parses back to the same value", () => {
    fc.assert(
      fc.property(json, (value) => {
        const text = canonicalize(value);
        expect(text).toMatch(/^[\x20-\x7e]*$/);
        expect(JSON.parse(text)).toEqual(value);
      }),
    );
  });

  it("ignores key insertion order", () => {
    fc.assert(
      fc.property(fc.dictionary(safeKey, json, { maxKeys: 6 }), (value) => {
        const reversed = Object.fromEntries(Object.entries(value).reverse());
        expect(canonicalize(reversed)).toBe(canonicalize(value));
      }),
    );
  });

  it("writes object keys in sorted order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string().map((key) => "k" + key),
          { maxLength: 6 },
        ),
        (keys) => {
          const value = Object.fromEntries(keys.map((key) => [key, null]));
          const parsed = Object.keys(JSON.parse(canonicalize(value)));
          expect(parsed).toEqual([...keys].sort());
        },
      ),
    );
  });

  it("writes any bigint as its decimal digits", () => {
    fc.assert(
      fc.property(fc.bigInt(), (n) => {
        expect(BigInt(canonicalize(n))).toBe(n);
      }),
    );
  });
});

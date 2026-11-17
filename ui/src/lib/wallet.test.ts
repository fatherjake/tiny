import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { keyFromSignature, keyMessage } from "./wallet";

describe("wallet keys", () => {
  it("asks the wallet to sign a message naming the lowercased address", () => {
    expect(keyMessage("0xAbC")).toBe(
      "tiny trading key\n\nSign to create the tiny trading key for this wallet.\nAnyone holding this signature can trade as you on tiny, so only sign it on tiny.\n\nwallet: 0xabc\nversion: 1",
    );
  });

  it("derives the key as the sha-256 of the signature bytes", async () => {
    const key = await keyFromSignature("0x" + "ab".repeat(65));
    expect(Buffer.from(key).toString("hex")).toBe(
      "39cd843414d5125dd308568ace26d04e60b7fa6d2b1a901fb5184fa2eae0598b",
    );
  });

  it("names the same wallet whatever the address case", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(..."0123456789abcdefABCDEF") }),
        (hex) => {
          expect(keyMessage("0x" + hex.toUpperCase())).toBe(
            keyMessage("0x" + hex.toLowerCase()),
          );
          expect(
            keyMessage("0x" + hex).endsWith(
              "\nwallet: 0x" + hex.toLowerCase() + "\nversion: 1",
            ),
          ).toBe(true);
        },
      ),
    );
  });

  it("matches sha-256 of the signature, with or without 0x", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 80 }), async (bytes) => {
        const hex = Buffer.from(bytes).toString("hex");
        const expected = createHash("sha256").update(bytes).digest("hex");
        expect(
          Buffer.from(await keyFromSignature("0x" + hex)).toString("hex"),
        ).toBe(expected);
        expect(Buffer.from(await keyFromSignature(hex)).toString("hex")).toBe(
          expected,
        );
      }),
    );
  });
});

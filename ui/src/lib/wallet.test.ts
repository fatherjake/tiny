import { describe, expect, it } from "vitest";

import { keyFromSignature, keyMessage } from "./wallet";

describe("wallet keys", () => {
  it("names the wallet in the message, case-insensitively", () => {
    expect(keyMessage("0xAbC")).toBe(keyMessage("0xabc"));
    expect(keyMessage("0xabc")).toContain("wallet: 0xabc");
  });

  it("turns one signature into the same 32-byte key every time", async () => {
    const sig = "0x" + "ab".repeat(65);
    const first = await keyFromSignature(sig);
    expect(first).toHaveLength(32);
    expect(await keyFromSignature(sig)).toEqual(first);
    expect(await keyFromSignature("0x" + "cd".repeat(65))).not.toEqual(first);
  });
});

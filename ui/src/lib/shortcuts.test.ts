import { describe, expect, it } from "vitest";

import { isLegendKey, shortcut, type Press } from "./shortcuts";

const press = (key: string, mods: Partial<Press> = {}): Press => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("shortcut", () => {
  it("maps the order letters, in either case", () => {
    expect(shortcut(press("m"), false)).toEqual({
      kind: "type",
      type: "market",
    });
    expect(shortcut(press("L"), false)).toEqual({
      kind: "type",
      type: "limit",
    });
    expect(shortcut(press("b"), false)).toEqual({ kind: "side", side: "buy" });
    expect(shortcut(press("S"), false)).toEqual({ kind: "side", side: "sell" });
    expect(shortcut(press("p"), false)).toEqual({ kind: "price" });
  });

  it("starts the size with the digit pressed", () => {
    expect(shortcut(press("5"), false)).toEqual({ kind: "size", digit: "5" });
  });

  it("leaves letters and digits to a field being typed in", () => {
    expect(shortcut(press("b"), true)).toBeNull();
    expect(shortcut(press("5"), true)).toBeNull();
    expect(shortcut(press("Escape"), true)).toEqual({ kind: "leave" });
    expect(shortcut(press("Escape"), false)).toBeNull();
  });

  it("leaves browser shortcuts alone", () => {
    expect(shortcut(press("s", { metaKey: true }), false)).toBeNull();
    expect(shortcut(press("m", { ctrlKey: true }), false)).toBeNull();
    expect(shortcut(press("b", { altKey: true }), false)).toBeNull();
  });

  it("ignores keys it does not bind", () => {
    expect(shortcut(press("x"), false)).toBeNull();
    expect(shortcut(press("Enter"), false)).toBeNull();
  });
});

describe("isLegendKey", () => {
  it("is Cmd or Ctrl only", () => {
    expect(
      ["Meta", "Control", "Shift", "Alt", "m"].map((key) => isLegendKey(key)),
    ).toEqual([true, true, false, false, false]);
  });
});

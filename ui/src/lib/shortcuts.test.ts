import { describe, expect, it } from "vitest";

import { shortcut, type Press } from "./shortcuts";

const press = (key: string, mods: Partial<Press> = {}): Press => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("shortcut", () => {
  it("maps the order letters, in either case", () => {
    expect(shortcut(press("m"), "none")).toEqual({
      kind: "type",
      type: "market",
    });
    expect(shortcut(press("L"), "none")).toEqual({
      kind: "type",
      type: "limit",
    });
    expect(shortcut(press("b"), "none")).toEqual({ kind: "side", side: "buy" });
    expect(shortcut(press("S"), "none")).toEqual({
      kind: "side",
      side: "sell",
    });
    expect(shortcut(press("p"), "none")).toEqual({ kind: "price" });
  });

  it("starts the size with the digit pressed", () => {
    expect(shortcut(press("5"), "none")).toEqual({ kind: "size", digit: "5" });
  });

  it("keeps letters as shortcuts in an amount field, and lets digits type", () => {
    expect(shortcut(press("b"), "amount")).toEqual({
      kind: "side",
      side: "buy",
    });
    expect(shortcut(press("5"), "amount")).toBeNull();
    expect(shortcut(press("."), "amount")).toBeNull();
    expect(shortcut(press("Escape"), "amount")).toEqual({ kind: "leave" });
  });

  it("leaves letters and digits to a text field", () => {
    expect(shortcut(press("b"), "text")).toBeNull();
    expect(shortcut(press("5"), "text")).toBeNull();
    expect(shortcut(press("Escape"), "text")).toEqual({ kind: "leave" });
    expect(shortcut(press("Escape"), "none")).toBeNull();
  });

  it("leaves browser shortcuts alone", () => {
    expect(shortcut(press("s", { metaKey: true }), "none")).toBeNull();
    expect(shortcut(press("m", { ctrlKey: true }), "amount")).toBeNull();
    expect(shortcut(press("b", { altKey: true }), "none")).toBeNull();
  });

  it("ignores keys it does not bind", () => {
    expect(shortcut(press("x"), "none")).toBeNull();
    expect(shortcut(press("x"), "amount")).toBeNull();
    expect(shortcut(press("Enter"), "amount")).toBeNull();
  });
});

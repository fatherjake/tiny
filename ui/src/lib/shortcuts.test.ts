import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fieldOf, shortcut, type Field, type Press } from "./shortcuts";

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

describe("fieldOf", () => {
  const input = (type: string, inputMode = "") => {
    const el = document.createElement("input");
    el.type = type;
    if (inputMode) el.inputMode = inputMode;
    return el;
  };

  it("treats a decimal input as an amount and other typing targets as text", () => {
    expect(fieldOf(input("text", "decimal"))).toBe("amount");
    expect(fieldOf(input("text"))).toBe("text");
    expect(fieldOf(input("number"))).toBe("text");
    expect(fieldOf(document.createElement("textarea"))).toBe("text");
    expect(fieldOf(document.createElement("select"))).toBe("text");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(fieldOf(editable)).toBe("text");
  });

  it("treats toggles, buttons and plain elements as no field", () => {
    expect(fieldOf(input("checkbox"))).toBe("none");
    expect(fieldOf(input("radio"))).toBe("none");
    expect(fieldOf(input("button"))).toBe("none");
    expect(fieldOf(input("submit"))).toBe("none");
    expect(fieldOf(document.createElement("button"))).toBe("none");
    expect(fieldOf(document.createElement("div"))).toBe("none");
    expect(fieldOf(document.createTextNode("x"))).toBe("none");
    expect(fieldOf(null)).toBe("none");
    expect(fieldOf(input("text"))).toBe("text");
  });
});

const field = fc.constantFrom<Field>("none", "amount", "text");
const anyPress = fc.record({
  key: fc.oneof(
    fc.string({ maxLength: 3 }),
    fc.constantFrom("Escape", "Enter"),
  ),
  metaKey: fc.boolean(),
  ctrlKey: fc.boolean(),
  altKey: fc.boolean(),
});

describe("shortcut properties", () => {
  it("never acts while a modifier is held", () => {
    fc.assert(
      fc.property(
        anyPress.filter((p) => p.metaKey || p.ctrlKey || p.altKey),
        field,
        (p, f) => {
          expect(shortcut(p, f)).toBeNull();
        },
      ),
    );
  });

  it("only ever leaves a text field", () => {
    fc.assert(
      fc.property(anyPress, (p) => {
        const result = shortcut(p, "text");
        const plain = !p.metaKey && !p.ctrlKey && !p.altKey;
        expect(result).toEqual(
          plain && p.key === "Escape" ? { kind: "leave" } : null,
        );
      }),
    );
  });

  it("starts the size with any digit outside a field", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (n) => {
        expect(shortcut(press(String(n)), "none")).toEqual({
          kind: "size",
          digit: String(n),
        });
      }),
    );
  });

  it("maps a letter the same in upper and lower case", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
        fc.constantFrom<Field>("none", "amount"),
        (letter, f) => {
          expect(shortcut(press(letter.toUpperCase()), f)).toEqual(
            shortcut(press(letter), f),
          );
        },
      ),
    );
  });
});

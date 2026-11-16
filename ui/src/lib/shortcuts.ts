export type Shortcut =
  | { kind: "type"; type: "market" | "limit" }
  | { kind: "side"; side: "buy" | "sell" }
  | { kind: "price" }
  | { kind: "size"; digit: string }
  | { kind: "leave" };

export type Press = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export const KEYS = {
  market: "M",
  limit: "L",
  buy: "B",
  sell: "S",
  price: "P",
  size: "0-9",
  submit: "↵",
} as const;

const LETTERS: Record<string, Shortcut> = {
  m: { kind: "type", type: "market" },
  l: { kind: "type", type: "limit" },
  b: { kind: "side", side: "buy" },
  s: { kind: "side", side: "sell" },
  p: { kind: "price" },
};

export type Field = "none" | "amount" | "text";

export function shortcut(press: Press, field: Field): Shortcut | null {
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  if (press.key === "Escape")
    return field === "none" ? null : { kind: "leave" };
  if (/^[0-9]$/.test(press.key)) {
    return field === "none" ? { kind: "size", digit: press.key } : null;
  }
  if (field === "text") return null;
  return LETTERS[press.key.toLowerCase()] ?? null;
}

export function fieldOf(target: EventTarget | null): Field {
  if (!(target instanceof HTMLElement)) return "none";
  if (target.isContentEditable) return "text";
  if (target instanceof HTMLInputElement) {
    if (["checkbox", "radio", "button", "submit"].includes(target.type)) {
      return "none";
    }
    return target.inputMode === "decimal" ? "amount" : "text";
  }
  return target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
    ? "text"
    : "none";
}

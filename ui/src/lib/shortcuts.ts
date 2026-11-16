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

export function shortcut(press: Press, typing: boolean): Shortcut | null {
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  if (press.key === "Escape") return typing ? { kind: "leave" } : null;
  if (typing) return null;
  if (/^[0-9]$/.test(press.key)) return { kind: "size", digit: press.key };
  return LETTERS[press.key.toLowerCase()] ?? null;
}

export function isLegendKey(key: string): boolean {
  return key === "Meta" || key === "Control";
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit"].includes(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  );
}

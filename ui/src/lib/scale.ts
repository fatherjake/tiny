import type { Scaled } from "../types";

export const SCALE = 1_000_000n;

export function bi(n: Scaled): bigint {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isSafeInteger(n)) throw new Error("use bigint above 2^53");
    return BigInt(n);
  }
  if (typeof n === "string" && /^-?\d+$/.test(n)) return BigInt(n);
  throw new Error("not an int");
}

export function fmt(n: Scaled | null | undefined | ""): string {
  if (n == null || n === "") return "-";
  const v = bi(n);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % SCALE).toString().padStart(6, "0");
  return (neg ? "-" : "") + (a / SCALE).toString() + "." + frac;
}

export function fmtSign(n: Scaled | null | undefined | ""): string {
  if (n == null || n === "") return "-";
  const v = bi(n);
  return v > 0n ? "+" + fmt(v) : fmt(v);
}

export function parseScaled(text: string): bigint {
  const s = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("enter a number");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 6) throw new Error("at most 6 decimal places");
  return BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, 6));
}

export function unscale(n: Scaled): string {
  const v = bi(n);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  const whole = (a / SCALE).toString();
  const body = frac ? whole + "." + frac : whole;
  return neg ? "-" + body : body;
}

export function tryScaled(text: string): bigint | null {
  try {
    return parseScaled(text);
  } catch {
    return null;
  }
}

export function short(value: unknown): string {
  if (value == null || value === "") return "-";
  return String(value).slice(0, 8);
}

export function pct(part: Scaled | null | undefined, whole: Scaled | null | undefined): string {
  if (part == null || whole == null) return "-";
  const den = bi(whole);
  if (den === 0n) return "-";
  const v = (bi(part) * 1_000_000n) / den;
  const neg = v < 0n;
  const a = neg ? -v : v;
  return (neg ? "-" : "") + (a / 10_000n).toString() + "." + (a % 10_000n).toString().padStart(4, "0") + "%";
}

// Dollars: "$1,234.57", rounded half up to the cent.
export function usd(n: Scaled | null | undefined | ""): string {
  if (n == null || n === "") return "-";
  const v = bi(n);
  const neg = v < 0n;
  const cents = ((neg ? -v : v) + SCALE / 200n) / (SCALE / 100n);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return (neg ? "-$" : "$") + whole + "." + frac;
}

export function usdSign(n: Scaled | null | undefined | ""): string {
  if (n == null || n === "") return "-";
  return bi(n) > 0n ? "+" + usd(n) : usd(n);
}

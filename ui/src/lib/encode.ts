// core/types.py encode: sorted keys, separators "," and ":", ensure_ascii, ints only.

export type Canon =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | Canon[]
  | { [key: string]: Canon };

export function bytesToHex(bytes: Iterable<number>): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function quote(text: string): string {
  let out = '"';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === undefined) throw new Error("bad code point");
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c > 0x7e) out += unicode(c);
    else out += ch;
  }
  return out + '"';
}

function unicode(c: number): string {
  if (c > 0xffff) {
    const u = c - 0x10000;
    return unit(0xd800 + (u >> 10)) + unit(0xdc00 + (u & 0x3ff));
  }
  return unit(c);
}

function unit(c: number): string {
  return "\\u" + c.toString(16).padStart(4, "0");
}

export function canonicalize(value: Canon): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("encode refuses floats");
    if (!Number.isSafeInteger(value)) throw new Error("use bigint above 2^53");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") return quote(value);
  if (value instanceof Uint8Array) return quote(bytesToHex(value));
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => quote(key) + ":" + canonicalize(value[key]));
    return "{" + parts.join(",") + "}";
  }
  throw new Error("cannot encode " + typeof value);
}

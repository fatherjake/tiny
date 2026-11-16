import { bytesToHex, canonicalize, type Canon } from "./encode";
import type { Signer } from "./keystore";

export class TxError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TxError";
    this.status = status;
  }
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text || String(res.status);
  }
  if (typeof body !== "object" || body === null || !("detail" in body)) {
    return text || String(res.status);
  }
  const detail = body.detail;
  if (res.status === 422 && Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item !== "object" || item === null) return "";
        const loc =
          "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
        const msg =
          "msg" in item && typeof item.msg === "string" ? item.msg : undefined;
        return loc ? loc + ": " + msg : msg;
      })
      .join("; ");
  }
  if (typeof detail === "string") return detail;
  if (detail != null) return JSON.stringify(detail);
  return text || String(res.status);
}

export async function signAndPost(
  key: Signer,
  body: Canon,
  nonce: number,
): Promise<unknown> {
  const signer = key.trader;
  const payload = new TextEncoder().encode(canonicalize([body, signer, nonce]));
  const sig = bytesToHex(await key.sign(payload));
  const res = await fetch("/tx", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: canonicalize({ body, signer, nonce, sig }),
  });
  if (res.ok) return res.json();
  throw new TxError(await errorText(res), res.status);
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

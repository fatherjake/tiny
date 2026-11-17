import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readJson, signAndPost, TxError } from "./api";
import type { Canon } from "./encode";
import type { Signer } from "./keystore";

type Posted = { url: string; init: RequestInit };

function stubFetch(respond: () => Response): Posted[] {
  const calls: Posted[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return respond();
    },
  );
  return calls;
}

function fakeSigner(trader: string): Signer & { seen: string[] } {
  const seen: string[] = [];
  return {
    trader,
    seen,
    sign: async (payload) => {
      seen.push(new TextDecoder().decode(payload));
      return new Uint8Array([payload.length & 0xff, 0x0a, 0xff]);
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<TxError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TxError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

function failWith(status: number, text: string): Promise<TxError> {
  stubFetch(() => new Response(text, { status }));
  return rejection(signAndPost(fakeSigner("ab"), { a: 1 }, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signAndPost", () => {
  it("signs the canonical triple and posts the canonical envelope", async () => {
    const calls = stubFetch(() => Response.json({ ok: true, height: 9 }));
    const key = fakeSigner("beef");

    const result = await signAndPost(key, { z: "x", a: [1, true] }, 7);

    expect(result).toEqual({ ok: true, height: 9 });
    expect(key.seen).toEqual(['[{"a":[1,true],"z":"x"},"beef",7]']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/tx");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "content-type": "application/octet-stream",
    });
    expect(calls[0].init.body).toBe(
      '{"body":{"a":[1,true],"z":"x"},"nonce":7,"sig":"210aff","signer":"beef"}',
    );
  });

  it("posts a body that parses back to what was signed", async () => {
    const leaf = fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.string(),
    );
    const canon = fc.letrec<{ value: Canon }>((tie) => ({
      value: fc.oneof(
        { depthSize: "small" },
        leaf,
        fc.array(tie("value"), { maxLength: 4 }),
        fc.dictionary(
          fc.string().filter((key) => key !== "__proto__"),
          tie("value"),
          { maxKeys: 4 },
        ),
      ),
    })).value;

    await fc.assert(
      fc.asyncProperty(
        canon,
        fc.string({
          unit: fc.constantFrom(..."0123456789abcdef"),
          minLength: 1,
        }),
        fc.nat(),
        async (body, trader, nonce) => {
          const calls = stubFetch(() => Response.json(null));
          const key = fakeSigner(trader);

          await signAndPost(key, body, nonce);

          expect(JSON.parse(key.seen[0])).toEqual([body, trader, nonce]);
          const sent = JSON.parse(String(calls[0].init.body));
          expect(sent.body).toEqual(body);
          expect(sent.signer).toBe(trader);
          expect(sent.nonce).toBe(nonce);
          expect(sent.sig).toMatch(/^[0-9a-f]{2}0aff$/);
        },
      ),
    );
  });

  it("throws a TxError carrying the status and the plain text body", async () => {
    const error = await failWith(503, "node is syncing");
    expect(error.name).toBe("TxError");
    expect(error.status).toBe(503);
    expect(error.message).toBe("node is syncing");
  });

  it("falls back to the status code when the error body is empty", async () => {
    expect((await failWith(502, "")).message).toBe("502");
  });

  it("uses a string detail", async () => {
    expect(
      (await failWith(400, JSON.stringify({ detail: "bad nonce" }))).message,
    ).toBe("bad nonce");
  });

  it("stringifies a structured detail", async () => {
    expect(
      (await failWith(409, JSON.stringify({ detail: { code: 3 } }))).message,
    ).toBe('{"code":3}');
    expect(
      (await failWith(400, JSON.stringify({ detail: ["a", "b"] }))).message,
    ).toBe('["a","b"]');
  });

  it("returns the raw JSON when there is no usable detail", async () => {
    expect((await failWith(500, "[1,2]")).message).toBe("[1,2]");
    expect((await failWith(500, "null")).message).toBe("null");
    expect((await failWith(500, '{"error":"x"}')).message).toBe(
      '{"error":"x"}',
    );
    expect((await failWith(500, '{"detail":null}')).message).toBe(
      '{"detail":null}',
    );
  });

  it("joins 422 validation errors as location: message", async () => {
    const detail = [
      { loc: ["body", "size"], msg: "must be positive" },
      { msg: "missing nonce" },
      { loc: [], msg: "empty loc" },
      "not an object",
      null,
    ];
    expect((await failWith(422, JSON.stringify({ detail }))).message).toBe(
      "body.size: must be positive; missing nonce; empty loc; ; ",
    );
  });

  it("does not print undefined for a 422 item without a message", async () => {
    const detail = [{ loc: ["body", "price"] }];
    expect((await failWith(422, JSON.stringify({ detail }))).message).toBe(
      "body.price",
    );
  });

  it("reports any string detail verbatim for any failing status", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 400, max: 599 }),
        fc.string(),
        async (status, detail) => {
          const error = await failWith(status, JSON.stringify({ detail }));
          expect(error.message).toBe(detail);
          expect(error.status).toBe(status);
        },
      ),
    );
  });

  it("reports any non-JSON body verbatim", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((text) => {
          try {
            JSON.parse(text);
            return false;
          } catch {
            return true;
          }
        }),
        async (text) => {
          expect((await failWith(500, text)).message).toBe(text);
        },
      ),
    );
  });
});

describe("readJson", () => {
  it("parses the response body", async () => {
    expect(await readJson(new Response('{"a":[1,"b"]}'))).toEqual({
      a: [1, "b"],
    });
  });
});

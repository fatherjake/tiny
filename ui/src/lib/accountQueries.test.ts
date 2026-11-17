import { QueryClient } from "@tanstack/react-query";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accountKeys,
  accountQuery,
  fillsQuery,
  openOrdersQuery,
  orderHistoryQuery,
} from "./accountQueries";
import type { StoredOrder, StoredTrade } from "../types";

function serve(respond: (url: string) => Response): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
    urls.push(url);
    return respond(url);
  });
  return urls;
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const order = (id: number, remaining: number): StoredOrder => ({
  order_id: id,
  trader: "ab",
  market: "BTC",
  side: id % 2 ? "buy" : "sell",
  type: "limit",
  price: 100_000_000 + id,
  size: 5_000_000,
  remaining,
  status: "open",
  reason: "",
  created_height: 10,
  updated_height: 11,
});

const fill: StoredTrade = {
  id: 4,
  height: 12,
  tx_index: 0,
  market: "ETH",
  price: 3_000_000_000,
  size: 1_000_000,
  taker: "ab",
  maker: "cd",
  side: "buy",
  liquidation: false,
  ts: 1_700_000_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("accountQuery", () => {
  it("caches the account view under the trader's key", async () => {
    const view = { trader: "ab", collateral: 5, positions: [] };
    const urls = serve(() => Response.json(view));
    const qc = client();

    await qc.query(accountQuery("ab"));

    expect(urls).toEqual(["/account/ab"]);
    expect(qc.getQueryData(["account", "ab", "view"])).toEqual(view);
  });

  it("caches null for an account the chain has never seen", async () => {
    serve(() => new Response("", { status: 404 }));
    const qc = client();

    expect(await qc.query(accountQuery("ab"))).toBeNull();
    expect(qc.getQueryState(["account", "ab", "view"])?.status).toBe("success");
  });

  it("fails on any other error status", async () => {
    serve(() => new Response("", { status: 500 }));
    await expect(client().query(accountQuery("ab"))).rejects.toThrow(
      "/account answered 500",
    );
  });
  it("encodes the trader in the account URL", async () => {
    const urls = serve(() => Response.json(null));
    await client().query(accountQuery("a/b?c"));
    expect(urls).toEqual(["/account/a%2Fb%3Fc"]);
  });
});

describe("openOrdersQuery", () => {
  it("turns stored rows into open orders sized by what remains", async () => {
    const urls = serve(() => Response.json([order(7, 2_000_000)]));
    const qc = client();

    await qc.query(openOrdersQuery("a b/c"));

    expect(urls).toEqual(["/accounts/a%20b%2Fc/orders?status=open"]);
    expect(qc.getQueryData(["account", "a b/c", "open"])).toEqual([
      {
        id: 7,
        market: "BTC",
        side: "buy",
        price: 100_000_007,
        size: 2_000_000,
      },
    ]);
  });

  it("keeps one open order per row, in server order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.nat(), fc.nat())),
        async (pairs) => {
          serve(() => Response.json(pairs.map(([id, rem]) => order(id, rem))));
          const open = await client().query(openOrdersQuery("ab"));
          expect(open.map((row) => [row.id, row.size])).toEqual(pairs);
        },
      ),
    );
  });

  it("fails with the URL and status", async () => {
    serve(() => new Response("", { status: 503 }));
    await expect(client().query(openOrdersQuery("ab"))).rejects.toThrow(
      "/accounts/ab/orders?status=open answered 503",
    );
  });
});

describe("orderHistoryQuery", () => {
  it("caches the last fifty stored orders as they are", async () => {
    const rows = [order(1, 0), order(2, 0)];
    const urls = serve(() => Response.json(rows));
    const qc = client();

    await qc.query(orderHistoryQuery("ab"));

    expect(urls).toEqual(["/accounts/ab/orders?status=history&limit=50"]);
    expect(qc.getQueryData(["account", "ab", "history"])).toEqual(rows);
  });
});

describe("fillsQuery", () => {
  it("caches the last fifty fills", async () => {
    const urls = serve(() => Response.json([fill]));
    const qc = client();

    await qc.query(fillsQuery("ab"));

    expect(urls).toEqual(["/accounts/ab/fills?limit=50"]);
    expect(qc.getQueryData(["account", "ab", "fills"])).toEqual([fill]);
  });
});

describe("account URLs", () => {
  it("round-trip any trader through the path segment", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (trader) => {
        const urls = serve(() => Response.json([]));
        await client().query(fillsQuery(trader));
        const match = /^\/accounts\/([^/?#]*)\/fills\?limit=50$/.exec(urls[0]);
        expect(match).not.toBeNull();
        expect(decodeURIComponent(match![1])).toBe(trader);
      }),
    );
  });

  it("invalidating everything for a trader refetches each of their queries", async () => {
    const urls = serve((url) =>
      Response.json(url.startsWith("/account/") ? null : []),
    );
    const qc = client();
    await Promise.all([
      qc.query(accountQuery("ab")),
      qc.query(openOrdersQuery("ab")),
      qc.query(orderHistoryQuery("ab")),
      qc.query(fillsQuery("ab")),
      qc.query(fillsQuery("cd")),
    ]);
    urls.length = 0;

    await qc.refetchQueries({
      queryKey: [...accountKeys.all, "ab"],
    });

    expect(urls.sort()).toEqual([
      "/account/ab",
      "/accounts/ab/fills?limit=50",
      "/accounts/ab/orders?status=history&limit=50",
      "/accounts/ab/orders?status=open",
    ]);
  });
});

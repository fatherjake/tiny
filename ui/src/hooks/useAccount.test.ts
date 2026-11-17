import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAccount,
  useAccountSelect,
  useFills,
  useOpenOrders,
  useOrderHistory,
} from "./useAccount";

let routes: Record<string, unknown> = {};
let asked: string[] = [];

beforeEach(() => {
  routes = {};
  asked = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (!(url in routes)) return new Response("", { status: 404 });
    return new Response(JSON.stringify(routes[url]));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function render<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(hook, { wrapper });
}

const account = {
  trader: "alice",
  collateral: "5000000",
  nonce: 4,
  positions: {},
};

const stored = {
  order_id: 9,
  trader: "alice",
  market: "BTC",
  side: "buy",
  type: "limit",
  price: "100000000",
  size: "2000000",
  remaining: "1500000",
  status: "open",
  reason: "",
  created_height: 3,
  updated_height: 4,
};

const fill = {
  id: 1,
  height: 4,
  tx_index: 0,
  market: "BTC",
  price: "100000000",
  size: "500000",
  taker: "bob",
  maker: "alice",
  side: "sell",
  liquidation: false,
  ts: 1000,
};

describe("useAccount", () => {
  it("returns null without asking the server when no trader is set", async () => {
    routes["/account/"] = account;
    const { result } = render(() => useAccount(""));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBe(null);
    expect(asked).toEqual([]);
  });

  it("returns the trader's account once loaded", async () => {
    routes["/account/alice"] = account;
    const { result } = render(() => useAccount("alice"));
    expect(result.current).toBe(null);
    await waitFor(() => expect(result.current).toEqual(account));
  });

  it("stays null for a trader the chain has never seen", async () => {
    const { result } = render(() => useAccount("ghost"));
    await waitFor(() => expect(asked).toEqual(["/account/ghost"]));
    expect(result.current).toBe(null);
  });
});

describe("useAccountSelect", () => {
  it("passes the account through the selector", async () => {
    routes["/account/alice"] = account;
    const { result } = render(() =>
      useAccountSelect("alice", (a) => (a ? a.nonce * 10 : -1)),
    );
    expect(result.current).toBe(undefined);
    await waitFor(() => expect(result.current).toBe(40));
  });

  it("selects from null for an unknown trader", async () => {
    const { result } = render(() =>
      useAccountSelect("ghost", (a) => (a ? a.nonce : "none")),
    );
    await waitFor(() => expect(result.current).toBe("none"));
  });
});

describe("account lists", () => {
  it("lists open orders as id, market, side, price and remaining size", async () => {
    routes["/accounts/alice/orders?status=open"] = [stored];
    const { result } = render(() => useOpenOrders("alice"));
    expect(result.current).toEqual([]);
    await waitFor(() =>
      expect(result.current).toEqual([
        {
          id: 9,
          market: "BTC",
          side: "buy",
          price: "100000000",
          size: "1500000",
        },
      ]),
    );
  });

  it("returns the last 50 orders as stored", async () => {
    routes["/accounts/alice/orders?status=history&limit=50"] = [stored];
    const { result } = render(() => useOrderHistory("alice"));
    await waitFor(() => expect(result.current).toEqual([stored]));
  });

  it("returns the last 50 fills as stored", async () => {
    routes["/accounts/bob%2F1/fills?limit=50"] = [fill];
    const { result } = render(() => useFills("bob/1"));
    await waitFor(() => expect(result.current).toEqual([fill]));
  });

  it("keeps the same empty list across renders while signed out", async () => {
    const { result, rerender } = render(() => ({
      open: useOpenOrders(""),
      history: useOrderHistory(""),
      fills: useFills(""),
    }));
    const first = result.current;
    rerender();
    expect(result.current.open).toBe(first.open);
    expect(result.current.history).toBe(first.history);
    expect(result.current.fills).toBe(first.fills);
    expect(first).toEqual({ open: [], history: [], fills: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual([]);
  });
});

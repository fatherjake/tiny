import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountView, MarketInfo } from "../types";
import { usePositionLines } from "./usePositionLines";

let routes: Record<string, unknown> = {};

beforeEach(() => {
  routes = {
    "/markets": [
      {
        name: "BTC",
        tick_size: "1",
        lot_size: "1",
        max_leverage: 10,
        maintenance_margin_bps: 500,
        oracle_price: null,
        mark_price: null,
        funding_index: null,
        funding_ts: null,
        funding_base: null,
      } satisfies MarketInfo,
    ],
  };
  vi.stubGlobal("fetch", async (url: string) => {
    if (!(url in routes)) return new Response("", { status: 404 });
    return new Response(JSON.stringify(routes[url]));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lines(trader: string, market: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(
    () => ({
      lines: usePositionLines(trader, market),
      ready:
        client.getQueryState(["market", "list"])?.status === "success" &&
        client.getQueryState(["account", trader, "view"])?.status !== "pending",
    }),
    { wrapper },
  );
}

function holding(size: string, entry_notional: string, collateral: string) {
  routes["/account/alice"] = {
    trader: "alice",
    collateral,
    nonce: 1,
    positions: { BTC: { market: "BTC", size, entry_notional } },
  } satisfies AccountView;
}

describe("usePositionLines", () => {
  it("draws entry and liquidation for a long", async () => {
    holding("2000000", "200000000", "50000000");
    const { result } = lines("alice", "BTC");
    await waitFor(() =>
      expect(result.current.lines).toEqual({
        entry: 100,
        liquidation: 78.947368,
      }),
    );
  });

  it("draws entry and liquidation for a short", async () => {
    holding("-2000000", "200000000", "50000000");
    const { result } = lines("alice", "BTC");
    await waitFor(() =>
      expect(result.current.lines).toEqual({
        entry: 100,
        liquidation: 119.047619,
      }),
    );
  });

  it("omits the liquidation line when collateral covers the whole long", async () => {
    holding("2000000", "200000000", "300000000");
    const { result } = lines("alice", "BTC");
    await waitFor(() =>
      expect(result.current.lines).toEqual({ entry: 100, liquidation: null }),
    );
  });

  it("draws nothing for a flat position", async () => {
    holding("0", "0", "50000000");
    const { result } = lines("alice", "BTC");
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lines).toBe(null);
  });

  it("draws nothing for a market the trader holds no position in", async () => {
    holding("2000000", "200000000", "50000000");
    routes["/markets"] = [
      ...(routes["/markets"] as MarketInfo[]),
      { ...(routes["/markets"] as MarketInfo[])[0], name: "ETH" },
    ];
    const { result } = lines("alice", "ETH");
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lines).toBe(null);
  });

  it("draws nothing for a market that is not listed", async () => {
    routes["/account/alice"] = {
      trader: "alice",
      collateral: "1",
      nonce: 1,
      positions: { DOGE: { market: "DOGE", size: "1", entry_notional: "1" } },
    } satisfies AccountView;
    const { result } = lines("alice", "DOGE");
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lines).toBe(null);
  });

  it("draws nothing for an account the chain has not seen", async () => {
    const { result } = lines("ghost", "BTC");
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lines).toBe(null);
  });

  it("draws nothing when no market is selected", async () => {
    holding("2000000", "200000000", "50000000");
    routes["/markets"] = [
      { ...(routes["/markets"] as MarketInfo[])[0], name: "" },
    ];
    routes["/account/alice"] = {
      trader: "alice",
      collateral: "50000000",
      nonce: 1,
      positions: {
        "": { market: "", size: "2000000", entry_notional: "200000000" },
      },
    } satisfies AccountView;
    const { result } = lines("alice", "");
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lines).toBe(null);
  });
});

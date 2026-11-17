import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCK_KEY,
  dockHeight,
  firstName,
  saveDock,
  savedDock,
} from "./App.utils";
import type { MarketInfo } from "./types";

const market = (name: string): MarketInfo => ({
  name,
  tick_size: 1,
  lot_size: 1,
  max_leverage: 10,
  maintenance_margin_bps: 500,
  oracle_price: null,
  mark_price: null,
  funding_index: null,
  funding_ts: null,
  funding_base: null,
});

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("savedDock", () => {
  it("returns 200 when nothing is stored", () => {
    expect(savedDock()).toBe(200);
  });

  it("returns a stored positive height", () => {
    localStorage.setItem(DOCK_KEY, "350");
    expect(savedDock()).toBe(350);
  });

  it.each(["0", "-40", "abc", ""])("falls back to 200 for %j", (value) => {
    localStorage.setItem(DOCK_KEY, value);
    expect(savedDock()).toBe(200);
  });

  it("falls back to 200 when storage throws", () => {
    vi.stubGlobal("localStorage", throwing);
    expect(savedDock()).toBe(200);
  });
});

describe("saveDock", () => {
  it("stores the height under the dock key", () => {
    saveDock(240);
    expect(localStorage.getItem("tiny.dock")).toBe("240");
    expect(savedDock()).toBe(240);
  });

  it("swallows storage errors", () => {
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveDock(240)).not.toThrow();
    vi.unstubAllGlobals();
    expect(localStorage.getItem("tiny.dock")).toBe(null);
  });

  it("round-trips any positive integer height", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (height) => {
        saveDock(height);
        return savedDock() === height;
      }),
    );
  });
});

describe("dockHeight", () => {
  it("clamps to 60 below the minimum", () => {
    expect(dockHeight(30, 1000)).toBe(60);
  });

  it("clamps to the viewport minus 200 above the maximum", () => {
    expect(dockHeight(950, 1000)).toBe(800);
  });

  it("rounds heights inside the range", () => {
    expect(dockHeight(300.6, 1000)).toBe(301);
    expect(dockHeight(300.4, 1000)).toBe(300);
  });

  it("stays within [60, viewport - 200] as an integer", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 260, max: 10_000 }),
        (height, viewport) => {
          const next = dockHeight(height, viewport);
          return Number.isInteger(next) && next >= 60 && next <= viewport - 200;
        },
      ),
    );
  });

  it("is monotonic in the dragged height", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 260, max: 10_000 }),
        (a, b, viewport) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return dockHeight(lo, viewport) <= dockHeight(hi, viewport);
        },
      ),
    );
  });
});

describe("firstName", () => {
  it("returns the first market's name", () => {
    expect(firstName([market("BTC-USD"), market("ETH-USD")])).toBe("BTC-USD");
  });

  it("returns an empty string when there are no markets", () => {
    expect(firstName([])).toBe("");
    expect(firstName([market("SOL-USD")])).toBe("SOL-USD");
  });
});

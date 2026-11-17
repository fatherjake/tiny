import type { MarketInfo } from "./types";

export const DOCK_KEY = "tiny.dock";

export function savedDock(): number {
  try {
    const value = Number(localStorage.getItem(DOCK_KEY));
    return value > 0 ? value : 200;
  } catch {
    return 200;
  }
}

export function dockHeight(height: number, viewport: number): number {
  return Math.round(Math.min(Math.max(height, 60), viewport - 200));
}

export function saveDock(height: number): void {
  try {
    localStorage.setItem(DOCK_KEY, String(height));
  } catch {}
}

export const firstName = (markets: MarketInfo[]) => markets[0]?.name ?? "";

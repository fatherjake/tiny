import { useMemo } from "react";

import { useAccountSelect } from "./useAccount";
import { useMarket } from "./useMarket";
import { entryPrice, liquidationPrice } from "../lib/orders";
import { bi } from "../lib/scale";

export type PositionLines = { entry: number; liquidation: number | null };

const dollars = (scaled: bigint) => Number(scaled) / 1e6;

export function usePositionLines(
  trader: string,
  market: string,
): PositionLines | null {
  const position = useAccountSelect(
    trader,
    (account) => account?.positions?.[market] ?? null,
  );
  const collateral = useAccountSelect(
    trader,
    (account) => account?.collateral ?? null,
  );
  const info = useMarket(market);
  return useMemo(() => {
    if (!market || !position || collateral == null || !info) return null;
    const size = bi(position.size);
    if (size === 0n) return null;
    const liquidation = liquidationPrice(
      { collateral: bi(collateral), size, entry: bi(position.entry_notional) },
      BigInt(info.maintenance_margin_bps),
    );
    return {
      entry: dollars(entryPrice(position)),
      liquidation: liquidation == null ? null : dollars(liquidation),
    };
  }, [market, position, collateral, info]);
}

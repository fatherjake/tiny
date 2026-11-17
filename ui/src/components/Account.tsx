import { useFlash } from "../hooks/useFlash";
import { useMarkets } from "../hooks/useMarket";
import { entryPrice, positionRisk, positionValue } from "../lib/orders";
import { bi, fmtSign, pctShort, usd, usdSign } from "../lib/scale";
import type { AccountView, Position, Scaled } from "../types";
import {
  pnlShare,
  pnlTone,
  positionSide,
  sortPositions,
  upnl,
} from "./Account.utils";

export type Pick = {
  picked: string | null;
  onPick: (market: string) => void;
};

type Props = {
  account: AccountView | null;
  onClose: (pos: Position) => void;
  pick?: Pick;
};

function PnlCell({
  pnl,
  margin,
}: {
  pnl: bigint | null;
  margin: bigint | null;
}) {
  const flash = useFlash(pnl == null ? null : pnl > 0n ? 1n : -1n);
  const tone = pnlTone(pnl);
  return (
    <td className={[tone, flash].filter(Boolean).join(" ")}>
      {usdSign(pnl)} {pnlShare(pnl, margin)}
    </td>
  );
}

export function Account({ account, onClose, pick }: Props) {
  const markets = useMarkets();
  const positions = sortPositions(account?.positions);
  const collateral = bi(account?.collateral ?? 0);
  return (
    <section className="grow">
      <table>
        <thead>
          <tr>
            <td className="l">market</td>
            <td>size</td>
            <td>entry</td>
            <td>liq.</td>
            <td>pnl</td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          {positions.length ? (
            positions.map((pos) => {
              const size = bi(pos.size);
              const side = positionSide(size);
              const market = markets.find((item) => item.name === pos.market);
              const mark: Scaled | null = market?.mark_price ?? null;
              const pnl = upnl(pos, mark);
              const risk = market
                ? positionRisk(
                    size,
                    bi(pos.entry_notional),
                    collateral,
                    mark,
                    market,
                  )
                : null;
              return (
                <tr
                  key={pos.market}
                  className={
                    pick
                      ? pick.picked === pos.market
                        ? "pick on"
                        : "pick"
                      : undefined
                  }
                  onClick={pick ? () => pick.onPick(pos.market) : undefined}
                >
                  <td className="l">{pos.market}</td>
                  <td>
                    {fmtSign(size)} {side}{" "}
                    <span className="muted">
                      {usd(positionValue(size, mark))}
                    </span>
                  </td>
                  <td>{usd(entryPrice(pos))}</td>
                  <td>
                    {usd(risk?.liquidation)}{" "}
                    <span className="muted">
                      {pctShort(risk?.toLiquidation, mark)}
                    </span>
                  </td>
                  <PnlCell pnl={pnl} margin={risk?.margin ?? null} />
                  <td>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(pos);
                      }}
                    >
                      close
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="l" colSpan={6}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

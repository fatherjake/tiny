import { useFlash } from "../hooks/useFlash";
import { useMarkets } from "../hooks/useMarket";
import { entryPrice, positionRisk, positionValue } from "../lib/orders";
import { SCALE, bi, fmtSign, pctShort, usd, usdSign } from "../lib/scale";
import type { AccountView, Position, Scaled } from "../types";

export type Pick = {
  picked: string | null;
  onPick: (market: string) => void;
};

type Props = {
  account: AccountView | null;
  onClose: (pos: Position) => void;
  pick?: Pick;
};

function upnl(pos: Position, mark: Scaled | null | undefined): bigint | null {
  if (mark == null) return null;
  const size = bi(pos.size);
  const abs = size < 0n ? -size : size;
  const notional = (abs * bi(mark)) / SCALE;
  const entry = bi(pos.entry_notional);
  return size > 0n ? notional - entry : entry - notional;
}

function PnlCell({
  pnl,
  margin,
}: {
  pnl: bigint | null;
  margin: bigint | null;
}) {
  const flash = useFlash(pnl == null ? null : pnl > 0n ? 1n : -1n);
  const tone = pnl == null || pnl === 0n ? "" : pnl > 0n ? "up" : "down";
  const share = pctShort(pnl, margin);
  return (
    <td className={[tone, flash].filter(Boolean).join(" ")}>
      {usdSign(pnl)} {pnl != null && pnl > 0n ? "+" + share : share}
    </td>
  );
}

export function Account({ account, onClose, pick }: Props) {
  const markets = useMarkets();
  const positions = Object.values(account?.positions ?? {}).sort((a, b) =>
    String(a.market).localeCompare(String(b.market)),
  );
  const collateral = bi(account?.collateral ?? 0);
  return (
    <section className="pad grow">
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
              const side = size > 0n ? "B" : size < 0n ? "S" : "";
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

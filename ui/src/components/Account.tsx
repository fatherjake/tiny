import { useMarkets } from "../hooks/useMarket";
import { positionValue } from "../lib/orders";
import { SCALE, bi, fmtSign, usd, usdSign } from "../lib/scale";
import type { AccountView, Position, Scaled } from "../types";

type Props = {
  account: AccountView | null;
  onClose: (pos: Position) => void;
};

function entryPrice(pos: Position): bigint {
  const size = bi(pos.size);
  if (size === 0n) return 0n;
  const abs = size < 0n ? -size : size;
  return (bi(pos.entry_notional) * SCALE) / abs;
}

function upnl(pos: Position, mark: Scaled | null | undefined): bigint | null {
  if (mark == null) return null;
  const size = bi(pos.size);
  const abs = size < 0n ? -size : size;
  const notional = (abs * bi(mark)) / SCALE;
  const entry = bi(pos.entry_notional);
  return size > 0n ? notional - entry : entry - notional;
}

export function Account({ account, onClose }: Props) {
  const markets = useMarkets();
  const positions = Object.values(account?.positions ?? {}).sort((a, b) =>
    String(a.market).localeCompare(String(b.market)),
  );
  const markOf = (name: string): Scaled | null => {
    const found = markets.find((item) => item.name === name);
    return found ? found.mark_price : null;
  };
  return (
    <section className="pad grow">
      <table>
        <thead>
          <tr>
            <td className="l">market</td>
            <td>size</td>
            <td>entry</td>
            <td>pnl</td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          {positions.length ? (
            positions.map((pos) => {
              const size = bi(pos.size);
              const side = size > 0n ? "B" : size < 0n ? "S" : "";
              const mark = markOf(pos.market);
              const pnl = upnl(pos, mark);
              return (
                <tr key={pos.market}>
                  <td className="l">{pos.market}</td>
                  <td>
                    {fmtSign(size)} {side}{" "}
                    <span className="muted">
                      {usd(positionValue(size, mark))}
                    </span>
                  </td>
                  <td>{usd(entryPrice(pos))}</td>
                  <td
                    className={
                      pnl == null || pnl === 0n ? "" : pnl > 0n ? "up" : "down"
                    }
                  >
                    {usdSign(pnl)}
                  </td>
                  <td>
                    <button type="button" onClick={() => onClose(pos)}>
                      close
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="l" colSpan={5}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

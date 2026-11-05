import { SCALE, bi, fmtSign, usd, usdSign } from "../lib/scale";
import type { AccountView, MarketInfo, Position, Scaled } from "../types";

type Props = {
  account: AccountView | null;
  markets: MarketInfo[];
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

export function Account({ account, markets, onClose }: Props) {
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
              return (
                <tr key={pos.market}>
                  <td className="l">{pos.market}</td>
                  <td>
                    {fmtSign(size)} {side}
                  </td>
                  <td>{usd(entryPrice(pos))}</td>
                  <td>{usdSign(upnl(pos, markOf(pos.market)))}</td>
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

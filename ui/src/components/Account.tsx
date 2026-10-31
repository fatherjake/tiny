import { SCALE, bi, fmt, fmtSign } from "../lib/scale";
import type { AccountView, MarketInfo, Position, Scaled } from "../types";

type Props = {
  account: AccountView | null;
  markets: MarketInfo[];
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

export function Account({ account, markets }: Props) {
  const positions = Object.values(account?.positions ?? {}).sort((a, b) =>
    String(a.market).localeCompare(String(b.market)),
  );
  const markOf = (name: string): Scaled | null => {
    const found = markets.find((item) => item.name === name);
    return found ? found.mark_price : null;
  };
  return (
    <section className="pad grow">
      <b>account</b> {account ? "" : "none"}
      <div>collateral {fmt(account?.collateral ?? 0)}</div>
      <div>account value {fmt(account?.account_value ?? 0)}</div>
      <div>maintenance margin {fmt(account?.maintenance_margin ?? 0)}</div>
      <table>
        <thead>
          <tr>
            <td className="l">market</td>
            <td>size</td>
            <td>entry</td>
            <td>pnl</td>
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
                  <td>{fmt(entryPrice(pos))}</td>
                  <td>{fmtSign(upnl(pos, markOf(pos.market)))}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="l" colSpan={4}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

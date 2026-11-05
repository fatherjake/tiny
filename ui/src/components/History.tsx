import { fmt, pct, usd } from "../lib/scale";
import type { FundingRow, MarketInfo, StoredOrder, StoredTrade } from "../types";

export function OrderHistory({ orders }: { orders: StoredOrder[] }) {
  return (
    <section className="pad grow">
      <table>
        <thead>
          <tr>
            <td className="l">market</td>
            <td>id</td>
            <td>side</td>
            <td>price</td>
            <td>remaining</td>
            <td className="l">status</td>
          </tr>
        </thead>
        <tbody>
          {orders.length ? (
            orders.map((order) => (
              <tr key={order.order_id}>
                <td className="l">{order.market}</td>
                <td>{String(order.order_id)}</td>
                <td>{order.side === "buy" ? "B" : "S"}</td>
                <td>{usd(order.price)}</td>
                <td>{fmt(order.remaining)}</td>
                <td className="l">
                  {order.status}
                  {order.reason ? " (" + order.reason + ")" : ""}
                </td>
              </tr>
            ))
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

export function Fills({ rows }: { rows: StoredTrade[] }) {
  return (
    <section className="pad grow">
      <table>
        <thead>
          <tr>
            <td>h</td>
            <td className="l">side</td>
            <td>price</td>
            <td>size</td>
            <td>liq</td>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{row.height}</td>
                <td className={row.side === "buy" ? "bid" : "ask"}>{row.side}</td>
                <td>{usd(row.price)}</td>
                <td>{fmt(row.size)}</td>
                <td>{row.liquidation ? "yes" : ""}</td>
              </tr>
            ))
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

export function Funding({ rows, markets }: { rows: FundingRow[]; markets: MarketInfo[] }) {
  return (
    <section className="pad grow">
      <table>
        <thead>
          <tr>
            <td>h</td>
            <td>index</td>
            <td>rate</td>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.market + ":" + row.height}>
                <td>{row.height}</td>
                <td>{usd(row.index)}</td>
                <td>{pct(row.rate, markets.find((m) => m.name === row.market)?.oracle_price)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="l" colSpan={3}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

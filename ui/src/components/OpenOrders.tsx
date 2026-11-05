import { fmt, usd } from "../lib/scale";
import type { OpenOrder } from "../types";

type Props = {
  orders: OpenOrder[];
  onCancel: (order: OpenOrder) => void;
};

export function OpenOrders({ orders, onCancel }: Props) {
  return (
    <section className="pad grow">
      <table>
        <thead>
          <tr>
            <td className="l">market</td>
            <td>id</td>
            <td>side</td>
            <td>price</td>
            <td>size</td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          {orders.length ? (
            orders.map((order) => (
              <tr key={order.market + ":" + order.id}>
                <td className="l">{order.market}</td>
                <td>{String(order.id)}</td>
                <td>{order.side === "buy" ? "B" : "S"}</td>
                <td>{usd(order.price)}</td>
                <td>{fmt(order.size)}</td>
                <td>
                  <button type="button" onClick={() => onCancel(order)}>
                    cancel
                  </button>
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

import { fmt, usd } from "../lib/scale";
import type { OpenOrder } from "../types";

type Props = {
  orders: OpenOrder[];
  onCancel: (order: OpenOrder) => void;
};

export function OpenOrders({ orders, onCancel }: Props) {
  return (
    <section className="pad grow">
      <b>cancel</b>
      {orders.length ? (
        <table>
          <tbody>
            {orders.map((order) => (
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
            ))}
          </tbody>
        </table>
      ) : (
        <div>none</div>
      )}
    </section>
  );
}

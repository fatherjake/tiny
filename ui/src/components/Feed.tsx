import { usePause } from "../hooks/usePause";
import { short } from "../lib/scale";
import type { BlockMsg } from "../types";
import { PausePill } from "./PausePill";

export function Feed({ blocks }: { blocks: BlockMsg[] }) {
  const pause = usePause(blocks);
  const rows = [];
  for (const block of pause.rows) {
    const txs = block.txs ?? [];
    rows.push(
      <tr key={"b" + block.hash}>
        <td>{block.height}</td>
        <td className="l">{short(block.hash)}</td>
        <td className="l" colSpan={2}>
          {txs.length + " tx"}
        </td>
      </tr>,
    );
    txs.forEach((tx, i) => {
      rows.push(
        <tr key={block.hash + "-" + i}>
          <td></td>
          <td className="l">{tx.kind}</td>
          <td className="l">{short(tx.signer)}</td>
          <td>{tx.nonce}</td>
        </tr>,
      );
    });
  }
  return (
    <section className="feed" ref={pause.ref} onScroll={pause.onScroll}>
      <table>
        <thead>
          <tr>
            <td>height</td>
            <td className="l">hash / kind</td>
            <td className="l">signer</td>
            <td>nonce</td>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td className="l" colSpan={4}>
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <PausePill paused={pause.paused} onResume={pause.resume} />
    </section>
  );
}

import type { WsMessage } from "../types";

/** The last block height and trade seq seen on the socket. */
export type StreamCursor = { height: number | null; seq: number | null };

export const START: StreamCursor = { height: null, seq: null };

/**
 * Move the cursor past msg and say whether frames were missed before it.
 *
 * core/api.py numbers blocks and trades consecutively, but a new connection
 * starts at the current tip and never replays. So a jump means frames were
 * lost, usually while the socket was reconnecting. A step backwards means the
 * node rebuilt its history from scratch. Either way, local state is stale.
 */
export function advance(
  cursor: StreamCursor,
  msg: WsMessage,
): { cursor: StreamCursor; gap: boolean } {
  if (msg.type === "block") {
    const gap = cursor.height !== null && msg.height !== cursor.height + 1;
    return { cursor: { ...cursor, height: msg.height }, gap };
  }
  if (msg.type === "trade") {
    const gap = cursor.seq !== null && msg.seq !== cursor.seq + 1;
    return { cursor: { ...cursor, seq: msg.seq }, gap };
  }
  // Book frames are full depth snapshots, so a lost one heals on the next.
  return { cursor, gap: false };
}

import type { WsMessage } from "../types";

export type StreamCursor = { height: number | null; seq: number | null };

export const START: StreamCursor = { height: null, seq: null };

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
  return { cursor, gap: false };
}

import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useWebSocket } from "./useWebSocket";
import { accountKeys } from "../lib/accountQueries";
import { advance, START } from "../lib/gaps";
import { marketKeys } from "../lib/marketQueries";
import { applyFrame, type FrameState } from "../lib/stream";

export function useMarketStream() {
  const client = useQueryClient();
  const state = useRef<FrameState>({ lastAccount: 0 });
  const cursor = useRef(START);

  const ws = useWebSocket("/ws", (msg) => {
    const next = advance(cursor.current, msg);
    if (next.gap) {
      console.warn("ws: missed frames, resyncing", {
        from: cursor.current,
        at: msg,
      });
      void client.invalidateQueries({ queryKey: marketKeys.all });
      void client.invalidateQueries({ queryKey: accountKeys.all });
    }
    cursor.current = next.cursor;
    applyFrame(client, msg, state.current);
  });

  return ws;
}

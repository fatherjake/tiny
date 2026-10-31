import { useEffect, useRef, useState } from "react";

import type { WsMessage } from "../types";

function parseWs(data: string): WsMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  // The type tag is checked. The fields are the frames core/api.py sends.
  if (value.type === "block" || value.type === "book" || value.type === "trade") {
    return value as WsMessage;
  }
  return null;
}

export function useWebSocket(path: string, onMessage: (msg: WsMessage) => void): string {
  const [status, setStatus] = useState("connecting");
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer = 0;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + path);
      ws.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = parseWs(String(ev.data));
          if (msg) handler.current(msg);
        } catch {
          /* ignore a bad frame */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(500 * 2 ** attempt, 8000);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [path]);
  return status;
}

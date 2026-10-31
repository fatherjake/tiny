import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The sim serves the API on 127.0.0.1:8000. The dev server proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tx": "http://127.0.0.1:8000",
      "/markets": "http://127.0.0.1:8000",
      "/book": "http://127.0.0.1:8000",
      "/account": "http://127.0.0.1:8000",
      "/trades": "http://127.0.0.1:8000",
      "/status": "http://127.0.0.1:8000",
      "/ws": { target: "http://127.0.0.1:8000", ws: true },
    },
  },
});

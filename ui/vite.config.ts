/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tx": "http://127.0.0.1:8000",
      "/markets": "http://127.0.0.1:8000",
      "/book": "http://127.0.0.1:8000",
      "/accounts": "http://127.0.0.1:8000",
      "/account": "http://127.0.0.1:8000",
      "/trades": "http://127.0.0.1:8000",
      "/candles": "http://127.0.0.1:8000",
      "/funding": "http://127.0.0.1:8000",
      "/status": "http://127.0.0.1:8000",
      "/ws": { target: "http://127.0.0.1:8000", ws: true },
    },
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/hooks/**/*.ts",
        "src/components/*.utils.ts",
      ],
      exclude: ["**/*.test.ts", "src/lib/wagmi.ts"],
      reporter: ["text"],
      thresholds: { perFile: true, 100: true },
    },
  },
});

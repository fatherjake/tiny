/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.TINY_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tx": api,
      "/markets": api,
      "/book": api,
      "/accounts": api,
      "/account": api,
      "/trades": api,
      "/candles": api,
      "/funding": api,
      "/status": api,
      "/ws": { target: api, ws: true },
    },
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/hooks/**/*.ts",
        "src/*.utils.ts",
        "src/components/*.utils.ts",
      ],
      exclude: ["**/*.test.ts", "src/lib/wagmi.ts"],
      reporter: ["text"],
      thresholds: { perFile: true, 100: true },
    },
  },
});

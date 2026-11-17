import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";

import { App } from "./App";
import "./index.css";
import { onCommit } from "./lib/perf";
import { wagmiConfig } from "./lib/wagmi";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

const queries = new QueryClient();

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queries}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#000", borderRadius: "none" })}
        >
          {import.meta.env.DEV ? (
            <Profiler id="app" onRender={onCommit}>
              <App />
            </Profiler>
          ) : (
            <App />
          )}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);

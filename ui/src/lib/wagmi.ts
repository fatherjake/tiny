import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "tiny",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "tiny-local",
  chains: [mainnet],
});

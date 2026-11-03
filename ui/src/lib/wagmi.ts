import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";

// Browser-extension wallets work without a WalletConnect project id. QR and mobile
// wallets need a real one in VITE_WALLETCONNECT_PROJECT_ID.
export const wagmiConfig = getDefaultConfig({
  appName: "tiny",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "tiny-local",
  chains: [mainnet],
});

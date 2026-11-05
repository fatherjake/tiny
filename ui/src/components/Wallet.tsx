import { ConnectButton } from "@rainbow-me/rainbowkit";

import { shorten, usd } from "../lib/scale";
import type { AccountView } from "../types";

type Props = {
  wallet: string | undefined;
  trader: string;
  account: AccountView | null;
  leverage: number | null;
  error: string;
  canSign: boolean;
  signing: boolean;
  onSign: () => void;
};

export function Wallet({ wallet, trader, account, leverage, error, canSign, signing, onSign }: Props) {
  return (
    <div className="pad">
      <ConnectButton.Custom>
        {({ account: connected, mounted, openAccountModal, openConnectModal }) => {
          if (!mounted) return null;
          if (!connected) {
            return (
              <button type="button" className="dark" onClick={openConnectModal}>
                connect wallet
              </button>
            );
          }
          return (
            <div className="row spread">
              <span>connected</span>
              <button type="button" onClick={openAccountModal}>
                {shorten(wallet ?? connected.address, 5, 3)}
              </button>
            </div>
          );
        }}
      </ConnectButton.Custom>
      {wallet && !trader ? (
        <>
          <button type="button" className="dark wide" disabled={!canSign} onClick={onSign}>
            {signing ? "Sign in your wallet" : "Enable trading"}
          </button>
          {error ? <div className="error stamp">{error}</div> : null}
        </>
      ) : null}
      {wallet && trader ? (
        <>
          <div className="row spread">
            <span>trader</span>
            <span title={trader}>{shorten(trader, 4, 4)}</span>
          </div>
          <div className="row spread">
            <span>collateral</span>
            <span>{usd(account?.collateral ?? 0)}</span>
          </div>
          <div className="row spread">
            <span>value</span>
            <span>{usd(account?.account_value ?? 0)}</span>
          </div>
          <div className="row spread">
            <span>margin</span>
            <span>{usd(account?.maintenance_margin ?? 0)}</span>
          </div>
          <div className="row spread">
            <span>leverage</span>
            <span>{leverage == null ? "-" : leverage + "x"}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

import { ConnectButton } from "@rainbow-me/rainbowkit";

type Props = {
  hex: string;
  trader: string;
  error: string;
  wallet: string | undefined;
  onHex: (value: string) => void;
  onGenerate: () => void;
  onWallet: () => void;
};

export function KeyBox({ hex, trader, error, wallet, onHex, onGenerate, onWallet }: Props) {
  return (
    <div className="pad">
      <div className="row">
        <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        <button type="button" disabled={!wallet} onClick={onWallet}>
          key from wallet
        </button>
      </div>
      <div className="row">
        <b>private key</b>
        <button type="button" onClick={onGenerate}>
          generate
        </button>
      </div>
      <input
        className="key"
        spellCheck={false}
        autoComplete="off"
        value={hex}
        onInput={(event) => onHex(event.currentTarget.value)}
      />
      <div>trader {trader || "-"}</div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}

type Props = {
  hex: string;
  trader: string;
  error: string;
  onHex: (value: string) => void;
  onGenerate: () => void;
};

export function KeyBox({ hex, trader, error, onHex, onGenerate }: Props) {
  return (
    <div className="pad">
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
      {error ? <div className="on">{error}</div> : null}
    </div>
  );
}

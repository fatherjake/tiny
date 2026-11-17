export function PausePill({
  paused,
  onResume,
}: {
  paused: boolean;
  onResume: () => void;
}) {
  if (!paused) return null;
  return (
    <button
      type="button"
      className="pill"
      title="updates paused while scrolled; click to catch up"
      onClick={onResume}
    >
      ❚❚ paused
    </button>
  );
}

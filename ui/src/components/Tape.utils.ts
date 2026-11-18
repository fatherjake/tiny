export const ROW_H = 21;
export const EAGER = 100;
export const AHEAD = 150;
export const BEHIND = 30;

export type Direction = 1 | -1;

export function visible(
  count: number,
  top: number,
  height: number,
  direction: Direction = 1,
) {
  if (top <= 0) return [0, Math.min(count, EAGER)] as const;
  const above = direction < 0 ? AHEAD : BEHIND;
  const below = direction > 0 ? AHEAD : BEHIND;
  const start = Math.min(count, Math.max(0, Math.floor(top / ROW_H) - above));
  const end = Math.min(count, Math.ceil((top + height) / ROW_H) + below);
  return [start, end] as const;
}

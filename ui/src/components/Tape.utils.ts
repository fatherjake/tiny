export const ROW_H = 21;
export const EAGER = 100;
export const OVERSCAN = 20;

export function visible(count: number, top: number, height: number) {
  if (top <= 0) return [0, Math.min(count, EAGER)] as const;
  const start = Math.min(
    count,
    Math.max(0, Math.floor(top / ROW_H) - OVERSCAN),
  );
  const end = Math.min(count, Math.ceil((top + height) / ROW_H) + OVERSCAN);
  return [start, end] as const;
}

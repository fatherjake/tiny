import type { Trade } from "../types";

export const seqs = (prints: Trade[]) =>
  new Set(prints.map((print) => print.seq));

export const TAPE_ROWS = 40;
export const FADE_MAX = 3;

export function nextFade(
  before: Trade[],
  after: Trade[],
  fading: Set<number>,
): Set<number> {
  const visible = after.slice(0, TAPE_ROWS);
  const known = seqs(before.slice(0, TAPE_ROWS));
  const arrived = visible.filter((print) => !known.has(print.seq));
  const keep = new Set(
    visible.filter((print) => fading.has(print.seq)).map((print) => print.seq),
  );
  if (before.length > 0 && arrived.length <= FADE_MAX) {
    for (const print of arrived) keep.add(print.seq);
  }
  return keep;
}

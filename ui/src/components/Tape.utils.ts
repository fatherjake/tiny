import type { Trade } from "../types";

export const seqs = (prints: Trade[]) =>
  new Set(prints.map((print) => print.seq));

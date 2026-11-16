import { useState } from "react";

type Flash = { dir: "" | "up" | "down"; n: number };

export function useFlash(value: bigint | null): string {
  const [seen, setSeen] = useState(value);
  const [flash, setFlash] = useState<Flash>({ dir: "", n: 0 });
  if (value !== seen) {
    setSeen(value);
    if (value != null && seen != null) {
      setFlash((prev) => ({
        dir: value > seen ? "up" : "down",
        n: prev.n + 1,
      }));
    }
  }
  return flash.dir ? `flash-${flash.dir} flash-${flash.n % 2}` : "";
}

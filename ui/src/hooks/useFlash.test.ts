import { cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { useFlash } from "./useFlash";

afterEach(cleanup);

function flash(initial: bigint | null) {
  return renderHook(({ value }) => useFlash(value), {
    initialProps: { value: initial },
  });
}

describe("useFlash", () => {
  it("stays quiet until the value moves", () => {
    const { result, rerender } = flash(5n);
    expect(result.current).toBe("");
    rerender({ value: 5n });
    expect(result.current).toBe("");
  });

  it("flashes up on a rise and down on a fall, toggling the phase each time", () => {
    const { result, rerender } = flash(5n);
    rerender({ value: 6n });
    expect(result.current).toBe("flash-up flash-1");
    rerender({ value: 4n });
    expect(result.current).toBe("flash-down flash-0");
    rerender({ value: 4n });
    expect(result.current).toBe("flash-down flash-0");
    rerender({ value: 9n });
    expect(result.current).toBe("flash-up flash-1");
  });

  it("does not flash when the value appears or disappears", () => {
    const { result, rerender } = flash(null);
    rerender({ value: 3n });
    expect(result.current).toBe("");
    rerender({ value: null });
    expect(result.current).toBe("");
    rerender({ value: 7n });
    expect(result.current).toBe("");
    rerender({ value: 8n });
    expect(result.current).toBe("flash-up flash-1");
    rerender({ value: null });
    expect(result.current).toBe("flash-up flash-1");
  });

  it("always reflects the direction of the last move and how many moves there were", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -5n, max: 5n }),
        fc.array(fc.option(fc.bigInt({ min: -5n, max: 5n }))),
        (first, rest) => {
          const { result, rerender, unmount } = flash(first);
          let seen: bigint | null = first;
          let moves = 0;
          let dir = "";
          for (const value of rest) {
            rerender({ value });
            if (value !== seen && value != null && seen != null) {
              moves += 1;
              dir = value > seen ? "up" : "down";
            }
            seen = value;
            expect(result.current).toBe(
              dir ? `flash-${dir} flash-${moves % 2}` : "",
            );
          }
          unmount();
        },
      ),
    );
  });
});

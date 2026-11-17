import { act, cleanup, renderHook } from "@testing-library/react";
import type { UIEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { usePause } from "./usePause";

afterEach(cleanup);

const at = (scrollTop: number) =>
  ({ currentTarget: { scrollTop } }) as unknown as UIEvent<HTMLElement>;

function pause(initial: number[]) {
  return renderHook(({ rows }) => usePause(rows), {
    initialProps: { rows: initial },
  });
}

describe("usePause", () => {
  it("follows the live rows while scrolled to the top", () => {
    const { result, rerender } = pause([1]);
    rerender({ rows: [2, 1] });
    expect(result.current.rows).toEqual([2, 1]);
    expect(result.current.paused).toBe(false);
  });

  it("holds the rows it had once scrolled away from the top", () => {
    const { result, rerender } = pause([1]);
    act(() => result.current.onScroll(at(40)));
    rerender({ rows: [2, 1] });
    act(() => result.current.onScroll(at(80)));
    expect(result.current.paused).toBe(true);
    expect(result.current.rows).toEqual([1]);
  });

  it("catches up when scrolled back to the top or resumed", () => {
    const { result, rerender } = pause([1]);
    act(() => result.current.onScroll(at(40)));
    rerender({ rows: [2, 1] });
    act(() => result.current.onScroll(at(0)));
    expect(result.current.rows).toEqual([2, 1]);

    act(() => result.current.onScroll(at(40)));
    rerender({ rows: [3, 2, 1] });
    act(() => result.current.resume());
    expect(result.current.paused).toBe(false);
    expect(result.current.rows).toEqual([3, 2, 1]);
  });

  it("scrolls the list back to the top on resume", () => {
    const { result } = pause([1]);
    const list = document.createElement("div");
    document.body.append(list);
    list.scrollTop = 40;
    result.current.ref.current = list;
    act(() => result.current.onScroll(at(40)));
    act(() => result.current.resume());
    expect(list.scrollTop).toBe(0);
    expect(result.current.paused).toBe(false);
    list.remove();
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onCommit } from "../lib/perf";
import {
  type PerfSample,
  type SimCounters,
  usePerfStats,
} from "./usePerfStats";

let clock = 0;
let frame: FrameRequestCallback | null = null;
let cancelled: number[] = [];
let frameId = 0;
let observers: FakeObserver[] = [];

class FakeObserver {
  static supportedEntryTypes = ["longtask"];
  observing = false;
  constructor(
    public report: (list: { getEntries: () => { duration: number }[] }) => void,
  ) {
    observers.push(this);
  }
  observe() {
    this.observing = true;
  }
  disconnect() {
    this.observing = false;
  }
}

function paint(at: number) {
  const run = frame!;
  frame = null;
  run(at);
}

function longTasks(...durations: number[]) {
  observers[0].report({
    getEntries: () => durations.map((duration) => ({ duration })),
  });
}

function tick(at: number) {
  clock = at;
  act(() => vi.advanceTimersByTime(1000));
}

beforeEach(() => {
  clock = 0;
  frame = null;
  cancelled = [];
  frameId = 0;
  observers = [];
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frame = run;
    return ++frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(id));
  vi.stubGlobal("PerformanceObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (performance as { memory?: unknown }).memory;
});

function stats(counters: SimCounters) {
  const samples: PerfSample[] = [];
  const view = renderHook(() =>
    usePerfStats(
      () => ({ ...counters }),
      (sample) => samples.push(sample),
    ),
  );
  return { ...view, samples };
}

describe("usePerfStats", () => {
  it("samples frames, long tasks, commits and sim throughput each second", () => {
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 5 * 1_048_576 },
      configurable: true,
    });
    onCommit("before", "mount", 999);
    const counters = { applied: 10, generated: 20, backlog: 0 };
    const { result, samples } = stats(counters);

    paint(16);
    paint(32);
    paint(100);
    longTasks(60, 90);
    onCommit("app", "update", 3);
    onCommit("app", "update", 5);
    counters.applied = 40;
    counters.generated = 70;
    counters.backlog = 7;
    tick(2000);

    const expected: PerfSample = {
      fps: 1.5,
      worstMs: 68,
      longTasks: 2,
      longMs: 150,
      heapMb: 5,
      nodes: document.getElementsByTagName("*").length,
      commits: 1,
      renderMs: 4,
      applied: 15,
      generated: 25,
      backlog: 7,
    };
    expect(samples).toEqual([expected]);
    expect(result.current).toEqual([expected]);
  });

  it("starts each second afresh and never reports negative throughput", () => {
    const counters = { applied: 50, generated: 50, backlog: 3 };
    const { samples } = stats(counters);
    paint(500);
    longTasks(80);
    tick(1000);
    counters.applied = 20;
    counters.generated = 10;
    tick(2000);
    expect(samples[1]).toMatchObject({
      fps: 0,
      worstMs: 0,
      longTasks: 0,
      longMs: 0,
      applied: 0,
      generated: 0,
      backlog: 3,
    });
  });

  it("reports long tasks as unknown where they cannot be observed", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const { samples } = stats({ applied: 0, generated: 0, backlog: 0 });
    tick(1000);
    expect(samples[0]).toMatchObject({
      longTasks: null,
      longMs: null,
      heapMb: null,
    });
  });

  it("keeps the last 60 samples", () => {
    const { result } = stats({ applied: 0, generated: 0, backlog: 0 });
    for (let second = 1; second <= 61; second++) tick(second * 1000);
    expect(result.current).toHaveLength(60);
  });

  it("stops sampling and watching once unmounted", () => {
    const { samples, unmount } = stats({
      applied: 0,
      generated: 0,
      backlog: 0,
    });
    paint(16);
    tick(1000);
    unmount();
    tick(2000);
    expect(samples).toHaveLength(1);
    expect(cancelled).toEqual([2]);
    expect(observers[0].observing).toBe(false);
  });

  it("averages frames over the elapsed seconds for any frame times", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 40 }),
        fc.integer({ min: 1, max: 5 }),
        (gaps, seconds) => {
          clock = 0;
          const { samples, unmount } = stats({
            applied: 0,
            generated: 0,
            backlog: 0,
          });
          let at = 0;
          for (const gap of gaps) paint((at += gap));
          tick(seconds * 1000);
          expect(samples[0].fps).toBeCloseTo(gaps.length / seconds);
          expect(samples[0].worstMs).toBe(gaps.length ? Math.max(...gaps) : 0);
          unmount();
        },
      ),
      { numRuns: 50 },
    );
  });
});

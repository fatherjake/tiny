import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canObserveLongTasks, heapMb, onCommit, takeCommits } from "./perf";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (performance as { memory?: unknown }).memory;
  takeCommits();
});

describe("commit counting", () => {
  it("adds up commits and their time, then starts again from zero", () => {
    takeCommits();
    onCommit("app", "update", 3);
    onCommit("app", "mount", 4.5);
    expect(takeCommits()).toEqual({ count: 2, ms: 7.5 });
    expect(takeCommits()).toEqual({ count: 0, ms: 0 });
  });

  it("reports every commit since the last take, for any durations", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000 })), (durations) => {
        takeCommits();
        for (const ms of durations) onCommit("app", "update", ms);
        expect(takeCommits()).toEqual({
          count: durations.length,
          ms: durations.reduce((sum, ms) => sum + ms, 0),
        });
      }),
    );
  });
});

describe("heapMb", () => {
  it("reads the used heap in megabytes where the browser exposes it", () => {
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 3 * 1_048_576 },
      configurable: true,
    });
    expect(heapMb()).toBe(3);
  });

  it("is unknown where the browser hides it", () => {
    expect(heapMb()).toBe(null);
  });
});

describe("canObserveLongTasks", () => {
  const observer = (types: string[] | undefined) =>
    Object.assign(function PerformanceObserver() {}, {
      supportedEntryTypes: types,
    });

  it("is true only when long tasks are a supported entry type", () => {
    vi.stubGlobal("PerformanceObserver", observer(["paint", "longtask"]));
    expect(canObserveLongTasks()).toBe(true);
    vi.stubGlobal("PerformanceObserver", observer(["paint"]));
    expect(canObserveLongTasks()).toBe(false);
    vi.stubGlobal("PerformanceObserver", observer(undefined));
    expect(canObserveLongTasks()).toBe(false);
  });

  it("is false without PerformanceObserver at all", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(canObserveLongTasks()).toBe(false);
  });
});

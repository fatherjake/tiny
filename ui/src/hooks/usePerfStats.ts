import { useEffect, useEffectEvent, useState } from "react";

import { canObserveLongTasks, heapMb, takeCommits } from "../lib/perf";

export type PerfSample = {
  fps: number;
  worstMs: number;
  longTasks: number | null;
  longMs: number | null;
  heapMb: number | null;
  nodes: number;
  commits: number;
  renderMs: number;
  applied: number;
  generated: number;
  backlog: number;
};

export type SimCounters = {
  applied: number;
  generated: number;
  backlog: number;
};

const HISTORY = 60;

export function usePerfStats(
  sim: () => SimCounters,
  onSample: (sample: PerfSample) => void,
) {
  const [history, setHistory] = useState<PerfSample[]>([]);
  const read = useEffectEvent(sim);
  const report = useEffectEvent(onSample);

  useEffect(() => {
    let frames = 0;
    let worst = 0;
    let prev = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      frames++;
      worst = Math.max(worst, now - prev);
      prev = now;
      raf = requestAnimationFrame(loop);
    });

    const watching = canObserveLongTasks();
    let longTasks = 0;
    let longMs = 0;
    const observer = watching
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks++;
            longMs += entry.duration;
          }
        })
      : null;
    observer?.observe({ type: "longtask", buffered: false });

    let last = read();
    let started = performance.now();
    takeCommits();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const seconds = (now - started) / 1000;
      started = now;
      const counters = read();
      const commits = takeCommits();
      const sample: PerfSample = {
        fps: frames / seconds,
        worstMs: worst,
        longTasks: watching ? longTasks : null,
        longMs: watching ? longMs : null,
        heapMb: heapMb(),
        nodes: document.getElementsByTagName("*").length,
        commits: commits.count / seconds,
        renderMs: commits.ms / seconds,
        applied: Math.max(0, counters.applied - last.applied) / seconds,
        generated: Math.max(0, counters.generated - last.generated) / seconds,
        backlog: counters.backlog,
      };
      last = counters;
      frames = 0;
      worst = 0;
      longTasks = 0;
      longMs = 0;
      setHistory((rows) => [...rows, sample].slice(-HISTORY));
      report(sample);
    }, 1000);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return history;
}

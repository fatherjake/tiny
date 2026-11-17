const commits = { count: 0, ms: 0 };

export function onCommit(_id: string, _phase: string, actualMs: number): void {
  commits.count++;
  commits.ms += actualMs;
}

export function takeCommits(): { count: number; ms: number } {
  const out = { ...commits };
  commits.count = 0;
  commits.ms = 0;
  return out;
}

export function heapMb(): number | null {
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory;
  return memory ? memory.usedJSHeapSize / 1_048_576 : null;
}

export function canObserveLongTasks(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask") === true
  );
}

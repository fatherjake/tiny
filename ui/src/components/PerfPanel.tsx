import { useQueryClient } from "@tanstack/react-query";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { type PerfSample, usePerfStats } from "../hooks/usePerfStats";
import { LoadSim, type Rates } from "../lib/loadSim";
import "./PerfPanel.css";

const POS_KEY = "tiny.perf";
const WIDTH = 300;
const RAMP_START = 100;
const RAMP_GROWTH = 1.5;
const RAMP_STEP_S = 5;
const FPS_FLOOR = 30;
const PRESETS = [100, 1_000, 5_000, 20_000];

type Pos = { x: number; y: number };

type Ramp = {
  rate: number;
  passed: number | null;
  seconds: number;
  fps: number;
};

function savedPos(): Pos {
  const fallback = {
    x: window.innerWidth - WIDTH - 16,
    y: window.innerHeight - 480,
  };
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as Pos) : fallback;
  } catch {
    return fallback;
  }
}

function clamp(pos: Pos): Pos {
  return {
    x: Math.min(Math.max(pos.x, 0), window.innerWidth - 80),
    y: Math.min(Math.max(pos.y, 0), window.innerHeight - 24),
  };
}

const num = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "-"
    : value.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });

function Spark({
  values,
  floor,
}: {
  values: (number | null)[];
  floor?: number;
}) {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) return <svg className="spark" />;
  const top = Math.max(...points, floor ?? 0) || 1;
  const step = 100 / (points.length - 1);
  const line = points
    .map(
      (v, i) => (i * step).toFixed(1) + "," + (28 - (v / top) * 26).toFixed(1),
    )
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      {floor != null ? (
        <line
          x1="0"
          x2="100"
          y1={28 - (floor / top) * 26}
          y2={28 - (floor / top) * 26}
          className="floor"
        />
      ) : null}
      <polyline points={line} />
    </svg>
  );
}

function Stat({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="row spread">
      <span>{label}</span>
      <span className={bad ? "error" : undefined}>{value}</span>
    </div>
  );
}

function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="row spread">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) =>
          onChange(Math.max(0, Number(event.currentTarget.value) || 0))
        }
      />
    </label>
  );
}

function Panel({ market, onClose }: { market: string; onClose: () => void }) {
  const client = useQueryClient();
  const sim = useRef<LoadSim | null>(null);
  const ramp = useRef<Ramp | null>(null);
  const [pos, setPos] = useState(savedPos);
  const [small, setSmall] = useState(false);
  const [rates, setRates] = useState<Rates>({
    trades: 1_000,
    books: 20,
    blocks: 2,
  });
  const [running, setRunning] = useState(false);
  const [ramping, setRamping] = useState<number | null>(null);
  const [result, setResult] = useState("");
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const history = usePerfStats(
    () => {
      const load = sim.current;
      return load
        ? {
            applied: load.applied,
            generated: load.generated,
            backlog: load.backlog,
          }
        : { applied: 0, generated: 0, backlog: 0 };
    },
    (sample) => {
      const step = ramp.current;
      const load = sim.current;
      if (!step || !load?.running) return;
      step.seconds++;
      if (step.seconds === 1) return;
      step.fps += sample.fps;
      const behind = sample.backlog > step.rate;
      if (step.seconds <= RAMP_STEP_S && !behind) return;
      const fps = step.fps / (step.seconds - 1);
      if (fps < FPS_FLOOR || behind) {
        setResult(
          (step.passed == null
            ? "struggled from the start"
            : "held " + num(step.passed) + " trades/s") +
            "; fell over at " +
            num(step.rate) +
            "/s (" +
            num(fps) +
            " fps, " +
            num(sample.backlog) +
            " queued)",
        );
        stop();
        return;
      }
      const rate = Math.ceil(step.rate * RAMP_GROWTH);
      ramp.current = { rate, passed: step.rate, seconds: 0, fps: 0 };
      load.rates = { ...load.rates, trades: rate };
      setRamping(rate);
    },
  );

  function loader(): LoadSim {
    if (!sim.current) sim.current = new LoadSim(client, market);
    return sim.current;
  }

  function start(next: Rates) {
    loader().start(next);
    setRunning(true);
  }

  function stop() {
    sim.current?.stop();
    sim.current = null;
    ramp.current = null;
    setRamping(null);
    setRunning(false);
  }

  function startRamp() {
    setResult("");
    ramp.current = { rate: RAMP_START, passed: null, seconds: 0, fps: 0 };
    setRamping(RAMP_START);
    start({ ...rates, trades: RAMP_START });
  }

  function change(next: Rates) {
    setRates(next);
    if (sim.current?.running && !ramp.current) sim.current.rates = next;
  }

  useEffect(() => () => sim.current?.stop(), []);
  useEffect(() => {
    sim.current?.stop();
    sim.current = null;
    ramp.current = null;
    setRamping(null);
    setRunning(false);
  }, [market]);

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {}
  }, [pos]);

  function grab(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const from = drag.current;
    if (!from) return;
    setPos(clamp({ x: event.clientX - from.dx, y: event.clientY - from.dy }));
  }

  const now: PerfSample | undefined = history[history.length - 1];
  const fpsBad = now != null && now.fps < FPS_FLOOR;

  return (
    <div className="perf" style={{ left: pos.x, top: pos.y, width: WIDTH }}>
      <div
        className="perf-bar"
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
      >
        <b>perf</b>
        <span>
          {now ? num(now.fps) + " fps" : "…"}
          {running ? " · load on" : ""}
        </span>
        <span className="perf-actions">
          <button
            type="button"
            title={small ? "expand" : "minimise"}
            onClick={() => setSmall((v) => !v)}
          >
            {small ? "▢" : "–"}
          </button>
          <button
            type="button"
            title="close and stop load"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            ×
          </button>
        </span>
      </div>
      {small ? null : (
        <div className="perf-body">
          <div className="muted">
            fake frames for {market || "-"}, fed through the real stream path
          </div>
          <RateInput
            label="trades / s"
            value={ramping ?? rates.trades}
            onChange={(trades) => change({ ...rates, trades })}
          />
          <div className="group">
            {PRESETS.map((rate) => (
              <button
                type="button"
                key={rate}
                className={!ramping && rates.trades === rate ? "on" : ""}
                onClick={() => change({ ...rates, trades: rate })}
              >
                {rate >= 1000 ? rate / 1000 + "k" : rate}
              </button>
            ))}
          </div>
          <RateInput
            label="book updates / s"
            value={rates.books}
            onChange={(books) => change({ ...rates, books })}
          />
          <RateInput
            label="blocks / s"
            value={rates.blocks}
            onChange={(blocks) => change({ ...rates, blocks })}
          />
          <div className="group">
            <button
              type="button"
              className={running && !ramping ? "on" : ""}
              onClick={() => (running ? stop() : start(rates))}
            >
              {running && !ramping ? "stop" : "run"}
            </button>
            <button
              type="button"
              className={ramping ? "on" : ""}
              onClick={() => (ramping ? stop() : startRamp())}
            >
              {ramping ? "stop ramp" : "ramp until it breaks"}
            </button>
          </div>
          {result ? <div className="perf-result">{result}</div> : null}

          <Spark values={history.map((s) => s.fps)} floor={FPS_FLOOR} />
          <Stat label="fps" value={num(now?.fps)} bad={fpsBad} />
          <Stat
            label="worst frame"
            value={now ? num(now.worstMs) + " ms" : "-"}
            bad={now != null && now.worstMs > 100}
          />
          <Stat
            label="long tasks / s"
            value={
              now?.longTasks == null
                ? "n/a"
                : num(now.longTasks) + " (" + num(now.longMs) + " ms)"
            }
          />
          <Stat
            label="react commits / s"
            value={
              now ? num(now.commits) + " (" + num(now.renderMs) + " ms)" : "-"
            }
          />
          <Spark values={history.map((s) => s.heapMb)} />
          <Stat
            label="js heap"
            value={now?.heapMb == null ? "n/a" : num(now.heapMb, 1) + " MB"}
          />
          <Stat label="dom nodes" value={num(now?.nodes)} />
          <Stat
            label="frames sent / applied"
            value={now ? num(now.generated) + " / " + num(now.applied) : "-"}
          />
          <Stat
            label="queued"
            value={num(now?.backlog)}
            bad={
              now != null && running && now.backlog > (ramping ?? rates.trades)
            }
          />
        </div>
      )}
    </div>
  );
}

export function PerfPanel({ market }: { market: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="perf-launch"
        title="performance and load simulation"
        aria-label="performance and load simulation"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="2" y="9" width="2.5" height="5" />
          <rect x="6.75" y="5" width="2.5" height="9" />
          <rect x="11.5" y="2" width="2.5" height="12" />
        </svg>
      </button>
      {open ? <Panel market={market} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

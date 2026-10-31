import { useEffect, useRef, useState } from "react";
// TradingView Lightweight Charts. Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
import {
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import type { Series } from "../types";

type Plot = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  line: ISeriesApi<"Line">;
};

type Props = {
  market: string;
  points: Series;
};

export function Chart({ market, points }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Plot | null>(null);
  const [span, setSpan] = useState<"1m" | "1s">("1m");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const edge = "rgba(0, 0, 0, 0.25)";
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#fff" },
        textColor: "#000",
        fontFamily: "sans-serif",
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(0, 0, 0, 0.12)" },
        horzLines: { color: "rgba(0, 0, 0, 0.12)" },
      },
      rightPriceScale: { borderColor: edge },
      timeScale: {
        borderColor: edge,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
        rightOffset: 4,
      },
      crosshair: {
        vertLine: { color: "#000", labelBackgroundColor: "#000" },
        horzLine: { color: "#000", labelBackgroundColor: "#000" },
      },
    });
    api.current = {
      chart,
      candles: chart.addSeries(CandlestickSeries, {
        upColor: "#18803a",
        downColor: "#c62828",
        borderUpColor: "#18803a",
        borderDownColor: "#c62828",
        wickUpColor: "#18803a",
        wickDownColor: "#c62828",
      }),
      line: chart.addSeries(LineSeries, { color: "#000", lineWidth: 2 }),
    };
    return () => {
      chart.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const plot = api.current;
    if (!plot) return;
    const seconds = span === "1s";
    plot.chart.applyOptions({ timeScale: { secondsVisible: seconds } });
    // lightweight-charts brands unix seconds as UTCTimestamp.
    plot.candles.setData(
      seconds ? [] : (points.bars ?? []).map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
    );
    plot.line.setData(
      seconds
        ? (points.sec ?? []).map((point) => ({ ...point, time: point.time as UTCTimestamp }))
        : [],
    );
  }, [points, span]);

  const shown = shownPrice(points, span);
  return (
    <section className="chart">
      <div className="row">
        <b>{market || "chart"}</b>
        <button type="button" className={span === "1m" ? "on" : ""} onClick={() => setSpan("1m")}>
          1m
        </button>
        <button type="button" className={span === "1s" ? "on" : ""} onClick={() => setSpan("1s")}>
          1s
        </button>
        <span>{shown == null ? "no price" : shown.toFixed(6)}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </div>
      <div className="plot" ref={host}></div>
    </section>
  );
}

function shownPrice(points: Series, span: "1m" | "1s"): number | null {
  if (span === "1s") {
    const rows = points.sec;
    const last = rows && rows.length > 0 ? rows[rows.length - 1] : undefined;
    return last ? last.value : null;
  }
  const rows = points.bars;
  const last = rows && rows.length > 0 ? rows[rows.length - 1] : undefined;
  return last ? last.close : null;
}

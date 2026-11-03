import { useEffect, useRef, useState } from "react";
// TradingView Lightweight Charts. Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
import {
  type AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type Time,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import type { Series } from "../types";

type Span = "1m" | "tick";

// The 1m view opens on the last 30 minutes, priced 2% either side of the last close.
const WINDOW_S = 30 * 60;
const BAND = 0.02;

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
  const [span, setSpan] = useState<Span>("1m");
  const spanRef = useRef(span);
  const fitted = useRef<string | null>(null);
  const shown = shownPrice(points, span);
  const shownRef = useRef(shown);
  spanRef.current = span;
  shownRef.current = shown;

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
      localization: {
        timeFormatter: (time: Time) => axisLabel(spanRef.current, time),
        priceFormatter: dollars,
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
        tickMarkFormatter: (time: Time) =>
          spanRef.current === "tick" ? axisLabel("tick", time) : null,
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
        autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
          const px = shownRef.current;
          if (px == null) return base();
          return { priceRange: { minValue: px * (1 - BAND), maxValue: px * (1 + BAND) } };
        },
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
    const ticks = span === "tick";
    const candles = points.bars;
    const count = ticks ? (points.ticks?.length ?? 0) : (candles?.length ?? 0);
    plot.candles.setData(
      ticks || !candles
        ? []
        : candles.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
    );
    plot.line.setData(
      ticks
        ? (points.ticks ?? []).map((point) => ({ ...point, time: point.time as UTCTimestamp }))
        : [],
    );
    const key = market + ":" + span + ":" + (count > 0);
    if (fitted.current !== key) {
      fitted.current = key;
      const last = candles && candles.length > 0 ? candles[candles.length - 1].time : null;
      if (!ticks && last != null) {
        plot.chart.priceScale("right").applyOptions({ autoScale: true });
        plot.chart.timeScale().setVisibleRange({
          from: (last - WINDOW_S) as UTCTimestamp,
          to: last as UTCTimestamp,
        });
      } else if (count > 0) {
        plot.chart.timeScale().fitContent();
      }
    }
  }, [market, points, span]);

  return (
    <section className="chart">
      <div className="row">
        <b>{market || "chart"}</b>
        <button type="button" className={span === "1m" ? "on" : ""} onClick={() => setSpan("1m")}>
          1m
        </button>
        <button
          type="button"
          className={span === "tick" ? "on" : ""}
          onClick={() => setSpan("tick")}
        >
          tick
        </button>
        <span>{shown == null ? "no price" : dollars(shown)}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </div>
      <div className="plot" ref={host}></div>
    </section>
  );
}

function dollars(price: number): string {
  return price.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function axisLabel(span: Span, time: Time): string {
  if (typeof time !== "number") return "";
  if (span === "tick") return String(time);
  const date = new Date(time * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function shownPrice(points: Series, span: Span): number | null {
  if (span === "tick") {
    const rows = points.ticks;
    const last = rows && rows.length > 0 ? rows[rows.length - 1] : undefined;
    return last ? last.value : null;
  }
  const rows = points.bars;
  const last = rows && rows.length > 0 ? rows[rows.length - 1] : undefined;
  return last ? last.close : null;
}

import { useEffect, useRef, useState } from "react";
import {
  type AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type Time,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import { useSeries } from "../hooks/useMarket";
import {
  type PositionLines,
  usePositionLines,
} from "../hooks/usePositionLines";
import type { Series } from "../types";

type Span = "1m" | "tick";

const WINDOW_S = 30 * 60;
const PAD = 1.15;
const MIN_HALF = 0.0005;

type Plot = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  line: ISeriesApi<"Line">;
};

type Props = {
  market: string;
  trader: string;
  picked: string | null;
};

function withLines(
  info: AutoscaleInfo | null,
  lines: PositionLines | null,
): AutoscaleInfo | null {
  if (!info?.priceRange || !lines) return info;
  const prices = [lines.entry, lines.liquidation].filter(
    (price): price is number => price != null,
  );
  return {
    ...info,
    priceRange: {
      minValue: Math.min(info.priceRange.minValue, ...prices),
      maxValue: Math.max(info.priceRange.maxValue, ...prices),
    },
  };
}

export function Chart({ market, trader, picked }: Props) {
  const points = useSeries(market);
  const lines = usePositionLines(trader, picked === market ? market : "");
  const linesRef = useRef(lines);
  linesRef.current = lines;
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
      rightPriceScale: {
        borderColor: edge,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
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
          const seen = base();
          if (px == null || seen?.priceRange == null) {
            return withLines(seen, linesRef.current);
          }
          const { minValue, maxValue } = seen.priceRange;
          const half = Math.max(
            (maxValue - px) * PAD,
            (px - minValue) * PAD,
            px * MIN_HALF,
          );
          return withLines(
            { priceRange: { minValue: px - half, maxValue: px + half } },
            linesRef.current,
          );
        },
      }),
      line: chart.addSeries(LineSeries, {
        color: "#000",
        lineWidth: 2,
        autoscaleInfoProvider: (base: () => AutoscaleInfo | null) =>
          withLines(base(), linesRef.current),
      }),
    };
    return () => {
      chart.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const plot = api.current;
    if (!plot || !lines) return;
    const series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> =
      span === "tick" ? plot.line : plot.candles;
    const line = (price: number, title: string, color: string) =>
      series.createPriceLine({
        price,
        title,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
      });
    const made: IPriceLine[] = [line(lines.entry, "entry", "#000")];
    if (lines.liquidation != null) {
      made.push(line(lines.liquidation, "liq.", "#c62828"));
    }
    plot.chart.priceScale("right").applyOptions({ autoScale: true });
    return () => {
      for (const priceLine of made) series.removePriceLine(priceLine);
    };
  }, [span, lines]);

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
        ? (points.ticks ?? []).map((point) => ({
            ...point,
            time: point.time as UTCTimestamp,
          }))
        : [],
    );
    const key = market + ":" + span + ":" + (count > 0);
    if (fitted.current !== key) {
      fitted.current = key;
      const last =
        candles && candles.length > 0 ? candles[candles.length - 1].time : null;
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
        <button
          type="button"
          className={span === "1m" ? "on" : ""}
          onClick={() => setSpan("1m")}
        >
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
      <div className="plot" ref={host}>
        {(span === "tick" ? points.ticks : points.bars) == null ? (
          <progress className="loading" aria-label="loading chart" />
        ) : null}
      </div>
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

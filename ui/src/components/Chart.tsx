import { useEffect, useRef, useState } from "react";
import {
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
import { usePositionLines } from "../hooks/usePositionLines";
import type { Series } from "../types";
import { SPANS, type Span, axisLabel, dollars, fitTarget } from "./Chart.utils";

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

export function Chart({ market, trader, picked }: Props) {
  const [span, setSpan] = useState<Span>("1m");
  const points = useSeries(market, span === "tick" ? "1m" : span);
  const lines = usePositionLines(trader, picked === market ? market : "");
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Plot | null>(null);
  const spanRef = useRef(span);
  const fitted = useRef<string | null>(null);
  spanRef.current = span;

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
        attributionLogo: true,
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
    const made: IPriceLine[] = [line(lines.entry, "entry", "#d9d9d9")];
    if (lines.liquidation != null) {
      made.push(line(lines.liquidation, "liq.", "#c62828"));
    }
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
      fitView(plot, span, points);
    }
  }, [market, points, span]);

  return (
    <section className="chart">
      <div className="tabs">
        {SPANS.map((id) => (
          <button
            type="button"
            key={id}
            className={span === id ? "on" : ""}
            onClick={() => setSpan(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="plot" ref={host}>
        {(span === "tick" ? points.ticks : points.bars) == null ? (
          <progress className="loading" aria-label="loading chart" />
        ) : null}
      </div>
    </section>
  );
}

function fitView(plot: Plot, span: Span, points: Series): void {
  const target = fitTarget(span, points);
  plot.chart.priceScale("right").applyOptions({ autoScale: true });
  if (target === "content") {
    plot.chart.timeScale().fitContent();
  } else if (target) {
    plot.chart.timeScale().setVisibleRange({
      from: target.from as UTCTimestamp,
      to: target.to as UTCTimestamp,
    });
  }
}

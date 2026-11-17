import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type Time,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import { useCandles } from "../hooks/useMarket";
import { usePositionLines } from "../hooks/usePositionLines";
import type { Interval } from "../lib/marketQueries";
import type { Candle } from "../types";
import {
  type Drawn,
  INTERVALS,
  axisLabel,
  dollars,
  fitTarget,
  planDraw,
  sameRow,
} from "./Chart.utils";

type Plot = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
};

type Props = {
  market: string;
  trader: string;
  picked: string | null;
};

export function Chart({ market, trader, picked }: Props) {
  const [interval, choose] = useState<Interval>("1m");
  const bars = useCandles(market, interval);
  const lines = usePositionLines(trader, picked === market ? market : "");
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Plot | null>(null);
  const fitted = useRef<string | null>(null);
  const drawn = useRef<Drawn>({ key: "", last: null, count: 0 });
  const shown = useRef<object | undefined>(undefined);
  const timeLabel = useEffectEvent((time: Time) => axisLabel(interval, time));

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
        timeFormatter: (time: Time) => timeLabel(time),
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
      },
      crosshair: {
        vertLine: { color: "#000", labelBackgroundColor: "#000" },
        horzLine: { color: "#000", labelBackgroundColor: "#000" },
      },
    });
    drawn.current = { key: "", last: null, count: 0 };
    shown.current = undefined;
    fitted.current = null;
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
    };
    return () => {
      chart.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const plot = api.current;
    if (!plot || !lines) return;
    const series = plot.candles;
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
  }, [lines]);

  useEffect(() => {
    const plot = api.current;
    if (!plot) return;
    const data = bars ?? [];
    const plan = planDraw(drawn.current, market + ":" + interval, data);
    const tail = data[data.length - 1];
    if (plan.kind === "reset") {
      plot.candles.setData(data.map(toPlot));
    } else if (plan.from < data.length - 1 || !sameRow(tail, shown.current)) {
      for (let i = plan.from; i < data.length; i++) {
        plot.candles.update(toPlot(data[i]));
      }
    }
    drawn.current = plan.drawn;
    shown.current = tail;
    const key = market + ":" + interval + ":" + (data.length > 0);
    if (fitted.current !== key) {
      fitted.current = key;
      fitView(plot.chart, interval, data);
    }
  }, [market, bars, interval]);

  return (
    <section className="chart">
      <div className="tabs">
        {INTERVALS.map((id) => (
          <button
            type="button"
            key={id}
            className={interval === id ? "on" : ""}
            onClick={() => choose(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="plot" ref={host}>
        {bars == null ? (
          <progress className="loading" aria-label="loading chart" />
        ) : null}
      </div>
    </section>
  );
}

function toPlot(bar: Candle) {
  return { ...bar, time: bar.time as UTCTimestamp };
}

function fitView(chart: IChartApi, interval: Interval, bars: Candle[]): void {
  chart.priceScale("right").applyOptions({ autoScale: true });
  const target = fitTarget(interval, bars);
  if (target) {
    chart.timeScale().setVisibleRange({
      from: target.from as UTCTimestamp,
      to: target.to as UTCTimestamp,
    });
  }
}

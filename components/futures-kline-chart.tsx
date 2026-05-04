"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface KlineBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  symbol: string;
  varietyName?: string;
  initialPeriod?: string;
}

const PERIODS = [
  { key: "30", label: "30m" },
  { key: "60", label: "1H" },
  { key: "daily", label: "D" },
  { key: "weekly", label: "W" },
  { key: "monthly", label: "M" },
];

const MA_CONFIG = [
  { period: 5, color: "#2196F3" },
  { period: 20, color: "#FF9800" },
  { period: 60, color: "#4CAF50" },
  { period: 120, color: "#E91E63" },
  { period: 250, color: "#9C27B0" },
];

function calcMA(data: KlineBar[], period: number) {
  const result: { time: string | number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push({ time: data[i].time, value: parseFloat((sum / period).toFixed(2)) });
  }
  return result;
}

export function FuturesKlineChart({ symbol, varietyName, initialPeriod = "daily" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState<KlineBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<KlineBar | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/futures/kline?symbol=${symbol}&period=${period}&start_date=20240101&end_date=20261231`
      );
      if (res.ok) {
        const bars = await res.json();
        if (Array.isArray(bars)) setData(bars);
      }
    } catch {
      /* data source offline */
    } finally {
      setLoading(false);
    }
  }, [symbol, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;

    let chart: ReturnType<typeof import("lightweight-charts").createChart>;
    let disposed = false;

    (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed) return;

      // Clean up previous chart
      if (chartRef.current) {
        try { (chartRef.current as { remove: () => void }).remove(); } catch { /* ok */ }
      }

      const isIntraday = period === "30" || period === "60";

      chart = LWC.createChart(containerRef.current!, {
        layout: { background: { type: LWC.ColorType.Solid, color: "#0a0a0f" }, textColor: "#888" },
        grid: { vertLines: { color: "#1a1a28" }, horzLines: { color: "#1a1a28" } },
        crosshair: {
          mode: LWC.CrosshairMode.Normal,
          vertLine: { color: "#ffd70066", width: 1, style: LWC.LineStyle.Dashed },
          horzLine: { color: "#ffd70066", width: 1, style: LWC.LineStyle.Dashed },
        },
        rightPriceScale: { borderColor: "#1e1e2e", scaleMargins: { top: 0.05, bottom: 0.25 } },
        timeScale: { borderColor: "#1e1e2e", timeVisible: isIntraday, secondsVisible: false },
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
      });

      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#ef5350",
        downColor: "#26a69a",
        borderUpColor: "#ef5350",
        borderDownColor: "#26a69a",
        wickUpColor: "#ef5350",
        wickDownColor: "#26a69a",
      });
      candleSeries.setData(data as Parameters<typeof candleSeries.setData>[0]);

      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeSeries.setData(
        data.map((d) => ({
          time: d.time as never,
          value: d.volume,
          color: d.close >= d.open ? "#ef535044" : "#26a69a44",
        }))
      );

      // Moving averages
      for (const ma of MA_CONFIG) {
        if (data.length > ma.period) {
          const line = chart.addLineSeries({
            color: ma.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          line.setData(calcMA(data, ma.period) as Parameters<typeof line.setData>[0]);
        }
      }

      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData?.get(candleSeries) as KlineBar | undefined;
        if (d) setInfo(d);
      });

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chart) {
          chart.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      });
      ro.observe(containerRef.current!);
    })();

    return () => {
      disposed = true;
      if (chartRef.current) {
        try { (chartRef.current as { remove: () => void }).remove(); } catch { /* ok */ }
        chartRef.current = null;
      }
    };
  }, [data, period]);

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#ffd700" }}>
            {symbol} {varietyName || ""}
          </span>
          {info && (
            <span className="text-xs font-mono" style={{ color: "#888" }}>
              O:{info.open} H:{info.high} L:{info.low} C:
              <span style={{ color: info.close >= info.open ? "#ef5350" : "#26a69a" }}>
                {info.close}
              </span>{" "}
              V:{info.volume}
            </span>
          )}
        </div>

        {/* Period selector */}
        <div className="flex gap-0.5 rounded-md p-0.5" style={{ background: "#1a1a28" }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="px-3 py-1 text-xs font-semibold rounded transition-colors"
              style={{
                background: period === p.key ? "#ffd700" : "transparent",
                color: period === p.key ? "#0a0a0f" : "#888",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* MA legend */}
      <div className="flex gap-3 text-xs">
        {MA_CONFIG.map((ma) => (
          <span key={ma.period} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: ma.color }}
            />
            MA{ma.period}
          </span>
        ))}
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden"
        style={{ height: 500, background: "#0a0a0f" }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-sm" style={{ color: "#888" }}>
              Loading...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

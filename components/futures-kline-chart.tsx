"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface KlineBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Variety {
  code: string;
  name: string;
  exchange: string;
  multiplier: number;
  price: number | null;
}

interface Props {
  initialCode?: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PERIODS = [
  { key: "30", label: "30m" },
  { key: "60", label: "1H" },
  { key: "daily", label: "D" },
  { key: "weekly", label: "W" },
  { key: "monthly", label: "M" },
];

const MA_DEFAULTS = [
  { period: 5, color: "#2196F3", enabled: true },
  { period: 20, color: "#FF9800", enabled: true },
  { period: 60, color: "#4CAF50", enabled: true },
  { period: 120, color: "#E91E63", enabled: true },
  { period: 250, color: "#9C27B0", enabled: true },
];

type DrawingTool = "cursor" | "trendline" | "hline" | "ray" | "rect" | "fib" | "measure";

interface Drawing {
  type: DrawingTool;
  p1?: { time: string | number; price: number };
  p2?: { time: string | number; price: number };
  price?: number;
  color: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function calcMA(data: KlineBar[], period: number) {
  const r: { time: string | number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += data[i - j].close;
    r.push({ time: data[i].time, value: +(s / period).toFixed(2) });
  }
  return r;
}

function fmtVol(v: number) {
  if (!v) return "—";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export function FuturesKlineChart({ initialCode }: Props) {
  /* ---------- state ---------- */
  const [varieties, setVarieties] = useState<Record<string, Variety[]>>({});
  const [exchange, setExchange] = useState("");
  const [code, setCode] = useState(initialCode?.toUpperCase() || "");
  const [period, setPeriod] = useState("daily");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<KlineBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<KlineBar | null>(null);
  const [infoSymbol, setInfoSymbol] = useState("");
  const [maConfig, setMaConfig] = useState(MA_DEFAULTS.map((m) => ({ ...m })));
  const [showMaPanel, setShowMaPanel] = useState(false);
  const [currentTool, setCurrentTool] = useState<DrawingTool>("cursor");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Variety[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const [analyzing, setAnalyzing] = useState(false);
  const [showRt, setShowRt] = useState(true);
  const [rtData, setRtData] = useState<{ symbol: string; name: string; price: number | null; change_pct: number; volume: number; oi: number }[]>([]);

  /* ---------- refs ---------- */
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<unknown>(null);
  const candleRef = useRef<unknown>(null);
  const volRef = useRef<unknown>(null);
  const maSeriesRef = useRef<unknown[]>([]);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const drawStateRef = useRef<{ type: DrawingTool; p1: { time: string | number; price: number } } | null>(null);
  const mouseRef = useRef<{ time: string | number; price: number } | null>(null);
  const rawDataRef = useRef<KlineBar[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  /* ---------- load varieties ---------- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/futures/varieties");
        if (!res.ok) return;
        const d = await res.json();
        setVarieties(d);
        const exs = Object.keys(d);
        if (exs.length && !exchange) {
          // If initialCode, find its exchange
          if (initialCode) {
            for (const [ex, items] of Object.entries(d) as [string, Variety[]][]) {
              if (items.some((v) => v.code.toUpperCase() === initialCode.toUpperCase())) {
                setExchange(ex);
                setCode(initialCode.toUpperCase());
                return;
              }
            }
          }
          setExchange(exs[0]);
          if (d[exs[0]]?.length) setCode(d[exs[0]][0].code);
        }
      } catch { /* offline */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- load chart data ---------- */
  const loadChart = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    const symbol = code.toUpperCase() + "0";
    const sd = startDate.replace(/-/g, "");
    const ed = endDate.replace(/-/g, "");
    try {
      const res = await fetch(`/api/futures/kline?symbol=${symbol}&start_date=${sd}&end_date=${ed}&period=${period}`);
      if (!res.ok) return;
      const bars = await res.json();
      if (Array.isArray(bars) && bars.length) {
        setData(bars);
        rawDataRef.current = bars;
        setInfoSymbol(symbol);
        const last = bars[bars.length - 1];
        setInfo(last);
      }
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [code, period, startDate, endDate]);

  useEffect(() => { loadChart(); }, [loadChart]);

  /* ---------- realtime quotes ---------- */
  useEffect(() => {
    if (!showRt || !code) return;
    const list = varieties[exchange] || [];
    const variety = list.find((v: Variety) => v.code === code);
    const cn = variety?.name || code;
    let active = true;
    const fetchRt = async () => {
      try {
        const res = await fetch(`/api/futures/realtime?code=${encodeURIComponent(cn)}`);
        if (res.ok) {
          const d = await res.json();
          if (active && Array.isArray(d)) setRtData(d);
        }
      } catch { /* offline */ }
    };
    fetchRt();
    const iv = setInterval(fetchRt, 10000);
    return () => { active = false; clearInterval(iv); };
  }, [showRt, code, exchange, varieties]);

  /* ---------- search ---------- */
  useEffect(() => {
    const all: Variety[] = [];
    for (const [ex, items] of Object.entries(varieties)) {
      for (const v of items) all.push({ ...v, exchange: ex });
    }
    if (!search.trim()) { setSuggestions(all.slice(0, 15)); return; }
    const q = search.toLowerCase();
    setSuggestions(
      all.filter((v) => v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)).slice(0, 15)
    );
  }, [search, varieties]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSug(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function selectVariety(v: Variety) {
    setExchange(v.exchange);
    setCode(v.code);
    setSearch(v.code + " - " + v.name);
    setShowSug(false);
  }

  /* ---------- init / update chart ---------- */
  useEffect(() => {
    if (!chartContainerRef.current || !data.length) return;
    let disposed = false;

    (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed) return;

      // remove old chart
      if (chartRef.current) {
        try { (chartRef.current as { remove: () => void }).remove(); } catch { /* */ }
      }

      const isIntraday = period === "30" || period === "60";
      const el = chartContainerRef.current!;

      const chart = LWC.createChart(el, {
        layout: { background: { type: LWC.ColorType.Solid, color: "#0a0a0f" }, textColor: "#888", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
        grid: { vertLines: { color: "#1a1a28" }, horzLines: { color: "#1a1a28" } },
        crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { color: "#ffd70066", width: 1, style: LWC.LineStyle.Dashed }, horzLine: { color: "#ffd70066", width: 1, style: LWC.LineStyle.Dashed } },
        rightPriceScale: { borderColor: "#1e1e2e", scaleMargins: { top: 0.05, bottom: 0.25 } },
        timeScale: { borderColor: "#1e1e2e", timeVisible: isIntraday, secondsVisible: false },
        width: el.clientWidth,
        height: el.clientHeight,
      });
      chartRef.current = chart;

      const candle = chart.addCandlestickSeries({ upColor: "#ef5350", downColor: "#26a69a", borderUpColor: "#ef5350", borderDownColor: "#26a69a", wickUpColor: "#ef5350", wickDownColor: "#26a69a" });
      candle.setData(data as Parameters<typeof candle.setData>[0]);
      candleRef.current = candle;

      const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "volume" });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(data.map((d) => ({ time: d.time as never, value: d.volume, color: d.close >= d.open ? "#ef535044" : "#26a69a44" })));
      volRef.current = vol;

      // MAs
      const maS: unknown[] = [];
      for (const ma of maConfig) {
        const line = chart.addLineSeries({ color: ma.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: ma.enabled });
        if (ma.enabled && data.length > ma.period) {
          line.setData(calcMA(data, ma.period) as Parameters<typeof line.setData>[0]);
        }
        maS.push(line);
      }
      maSeriesRef.current = maS;

      // crosshair
      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData?.get(candle) as KlineBar | undefined;
        if (d) setInfo(d);
      });

      chart.timeScale().fitContent();
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => renderDrawings());

      // resize
      const ro = new ResizeObserver(() => {
        if (el && chartRef.current) {
          (chartRef.current as { applyOptions: (o: { width: number; height: number }) => void }).applyOptions({ width: el.clientWidth, height: el.clientHeight });
          resizeDrawCanvas();
        }
      });
      ro.observe(el);

      // init draw canvas
      resizeDrawCanvas();
    })();

    return () => {
      disposed = true;
      if (chartRef.current) { try { (chartRef.current as { remove: () => void }).remove(); } catch { /* */ } chartRef.current = null; }
    };
  }, [data, period]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- live candle updater (poll every 5s) ---------- */
  useEffect(() => {
    if (!code || !data.length || !candleRef.current || !volRef.current) return;
    const sym = code.toUpperCase() + "0";
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/futures/tick?symbol=${sym}`);
        if (!res.ok) return;
        const tick = await res.json();
        if (!tick.price || tick.error) return;

        const lastBar = rawDataRef.current[rawDataRef.current.length - 1];
        if (!lastBar) return;

        if (period === "daily") {
          const todayStr = new Date().toISOString().slice(0, 10);
          if (lastBar.time === todayStr) {
            lastBar.high = Math.max(lastBar.high, tick.price);
            lastBar.low = Math.min(lastBar.low, tick.price);
            lastBar.close = tick.price;
            lastBar.volume = tick.volume || lastBar.volume;
          } else {
            rawDataRef.current.push({ time: todayStr, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.volume || 0 });
          }
        } else {
          lastBar.high = Math.max(lastBar.high, tick.price);
          lastBar.low = Math.min(lastBar.low, tick.price);
          lastBar.close = tick.price;
          lastBar.volume = tick.volume || lastBar.volume;
        }

        const bar = rawDataRef.current[rawDataRef.current.length - 1];
        (candleRef.current as { update: (b: unknown) => void }).update(bar);
        (volRef.current as { update: (b: unknown) => void }).update({
          time: bar.time, value: bar.volume,
          color: bar.close >= bar.open ? "#ef535044" : "#26a69a44",
        });
        setInfo(bar);
      } catch { /* next tick */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [code, data.length, period]);

  /* ---------- drawing canvas helpers ---------- */
  function resizeDrawCanvas() {
    const canvas = drawCanvasRef.current;
    const container = chartContainerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + "px";
    canvas.style.height = container.clientHeight + "px";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderDrawings();
  }

  function pxToData(x: number, y: number) {
    if (!chartRef.current || !candleRef.current) return null;
    const chart = chartRef.current as { timeScale: () => { coordinateToTime: (x: number) => string | number | null } };
    const candle = candleRef.current as { coordinateToPrice: (y: number) => number | null };
    const time = chart.timeScale().coordinateToTime(x);
    const price = candle.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  }

  function dataToPixel(time: string | number, price: number) {
    if (!chartRef.current || !candleRef.current) return null;
    const chart = chartRef.current as { timeScale: () => { timeToCoordinate: (t: string | number) => number | null } };
    const candle = candleRef.current as { priceToCoordinate: (p: number) => number | null };
    const x = chart.timeScale().timeToCoordinate(time);
    const y = candle.priceToCoordinate(price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  function renderDrawings() {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    for (const d of drawingsRef.current) renderOneDrawing(ctx, d, w, h, false);

    const ds = drawStateRef.current;
    const mc = mouseRef.current;
    if (ds && mc) {
      renderOneDrawing(ctx, { type: ds.type, p1: ds.p1, p2: mc, color: "#ffd70088" }, w, h, true);
    }
  }

  function renderOneDrawing(ctx: CanvasRenderingContext2D, d: Drawing, w: number, _h: number, preview: boolean) {
    ctx.save();
    ctx.strokeStyle = d.color || "#ffd700";
    ctx.fillStyle = d.color || "#ffd700";
    ctx.lineWidth = preview ? 1 : 1.5;
    if (preview) ctx.setLineDash([6, 4]);

    if (d.type === "hline" && d.price != null) {
      const py = dataToPixel(0, d.price);
      if (!py) { ctx.restore(); return; }
      // use priceToCoordinate directly
      const candle = candleRef.current as { priceToCoordinate: (p: number) => number | null } | null;
      const y = candle?.priceToCoordinate(d.price);
      if (y == null) { ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.font = "11px sans-serif";
      const txt = d.price.toFixed(2);
      const tw = ctx.measureText(txt).width + 8;
      ctx.fillStyle = d.color || "#ffd700";
      ctx.fillRect(w - tw - 4, y - 9, tw, 18);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillText(txt, w - tw, y + 4);
    } else if (d.type === "trendline" && d.p1 && d.p2) {
      const a = dataToPixel(d.p1.time, d.p1.price);
      const b = dataToPixel(d.p2.time, d.p2.price);
      if (!a || !b) { ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (d.type === "ray" && d.p1 && d.p2) {
      const a = dataToPixel(d.p1.time, d.p1.price);
      const b = dataToPixel(d.p2.time, d.p2.price);
      if (!a || !b) { ctx.restore(); return; }
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) { ctx.restore(); return; }
      const ext = Math.max(w, _h) * 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + (dx / len) * ext, b.y + (dy / len) * ext); ctx.stroke();
    } else if (d.type === "rect" && d.p1 && d.p2) {
      const a = dataToPixel(d.p1.time, d.p1.price);
      const b = dataToPixel(d.p2.time, d.p2.price);
      if (!a || !b) { ctx.restore(); return; }
      ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.globalAlpha = 1;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (d.type === "fib" && d.p1 && d.p2) {
      const candle = candleRef.current as { priceToCoordinate: (p: number) => number | null } | null;
      if (!candle) { ctx.restore(); return; }
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const colors = ["#ef5350", "#FF9800", "#FFD700", "#4CAF50", "#2196F3", "#9C27B0", "#ef5350"];
      const pH = d.p1.price, pL = d.p2.price;
      levels.forEach((lv, i) => {
        const price = pH - (pH - pL) * lv;
        const py = candle.priceToCoordinate(price);
        if (py == null) return;
        ctx.strokeStyle = colors[i];
        ctx.globalAlpha = preview ? 0.5 : 0.7;
        ctx.setLineDash(lv === 0 || lv === 1 ? [] : [4, 3]);
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = "10px sans-serif";
        ctx.fillStyle = colors[i];
        ctx.fillText((lv * 100).toFixed(1) + "% " + price.toFixed(2), w - 100, py - 3);
      });
    } else if (d.type === "measure" && d.p1 && d.p2) {
      const a = dataToPixel(d.p1.time, d.p1.price);
      const b = dataToPixel(d.p2.time, d.p2.price);
      if (!a || !b) { ctx.restore(); return; }
      ctx.setLineDash([5, 4]); ctx.strokeStyle = "#42a5f5"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // info box
      const diff = d.p2.price - d.p1.price;
      const pct = (diff / d.p1.price * 100);
      ctx.setLineDash([]);
      ctx.font = "12px -apple-system, sans-serif";
      const txt = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      const tw = ctx.measureText(txt).width + 16;
      const bx = (a.x + b.x) / 2 - tw / 2;
      const by = Math.min(a.y, b.y) - 28;
      ctx.fillStyle = "#1a2332"; ctx.globalAlpha = 0.92;
      ctx.fillRect(bx, by, tw, 22);
      ctx.globalAlpha = 1; ctx.strokeStyle = "#42a5f5"; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, tw, 22);
      ctx.fillStyle = diff >= 0 ? "#ef5350" : "#26a69a";
      ctx.fillText(txt, bx + 8, by + 16);
    }
    ctx.restore();
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (currentTool === "cursor") return;
    const rect = drawCanvasRef.current!.getBoundingClientRect();
    const d = pxToData(e.clientX - rect.left, e.clientY - rect.top);
    if (!d) return;

    if (currentTool === "hline") {
      drawingsRef.current.push({ type: "hline", price: d.price, color: "#ffd700" });
      setCurrentTool("cursor");
      renderDrawings();
      return;
    }

    if (!drawStateRef.current) {
      drawStateRef.current = { type: currentTool, p1: d };
    } else {
      drawingsRef.current.push({ type: drawStateRef.current.type, p1: drawStateRef.current.p1, p2: d, color: "#ffd700" });
      drawStateRef.current = null;
      setCurrentTool("cursor");
      renderDrawings();
    }
  }

  function handleCanvasMouseMove(e: React.MouseEvent) {
    const rect = drawCanvasRef.current!.getBoundingClientRect();
    mouseRef.current = pxToData(e.clientX - rect.left, e.clientY - rect.top);
    if (drawStateRef.current) renderDrawings();
  }

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (e.key === "Escape") setCurrentTool("cursor");
      else if (e.key === "t" || e.key === "T") setCurrentTool("trendline");
      else if (e.key === "h" || e.key === "H") setCurrentTool("hline");
      else if (e.key === "r" || e.key === "R") setCurrentTool("ray");
      else if (e.key === "g" || e.key === "G") setCurrentTool("rect");
      else if (e.key === "f" || e.key === "F") setCurrentTool("fib");
      else if (e.key === "m" || e.key === "M") setCurrentTool("measure");
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); drawingsRef.current.pop(); renderDrawings(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- variety list for current exchange ---------- */
  const exchangeList = Object.keys(varieties);
  const varietyList = varieties[exchange] || [];

  /* ---------- tool buttons ---------- */
  const tools: { key: DrawingTool; label: string; icon: string }[] = [
    { key: "cursor", label: "Cursor (Esc)", icon: "M4 2l12 8-6 1.5L7.5 18z" },
    { key: "trendline", label: "Trend Line (T)", icon: "M3 17L17 3" },
    { key: "hline", label: "H-Line (H)", icon: "M2 10H18" },
    { key: "ray", label: "Ray (R)", icon: "M3 14L18 6" },
    { key: "rect", label: "Rectangle (G)", icon: "M3 5h14v10H3z" },
    { key: "fib", label: "Fibonacci (F)", icon: "M2 4H18M2 8H18M2 12H18M2 16H18" },
    { key: "measure", label: "Measure (M)", icon: "M3 17L17 3" },
  ];

  /* ================================================================ */
  /* Render                                                            */
  /* ================================================================ */

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)", background: "#0a0a0f", color: "#e0e0e0" }}>

      {/* ===== TOP BAR ===== */}
      <div className="flex items-center gap-3 px-4 py-2 flex-wrap" style={{ background: "#12121a", borderBottom: "1px solid #1e1e2e" }}>
        <span className="text-base font-bold" style={{ color: "#ffd700" }}>Futures K-Line</span>

        {/* Search */}
        <div ref={searchRef} className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSug(true); setSugIdx(-1); }}
            onFocus={() => setShowSug(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (suggestions[sugIdx >= 0 ? sugIdx : 0]) selectVariety(suggestions[sugIdx >= 0 ? sugIdx : 0]); }
              else if (e.key === "Escape") setShowSug(false);
            }}
            placeholder="Search code or name..."
            className="pl-7 pr-3 py-1.5 text-xs rounded outline-none w-52"
            style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0" }}
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "#555" }}>&#x1F50D;</span>
          {showSug && suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-80 max-h-80 overflow-y-auto rounded-md shadow-lg z-50" style={{ background: "#16161f", border: "1px solid #2a2a3a" }}>
              {suggestions.map((v, i) => (
                <div
                  key={`${v.exchange}-${v.code}`}
                  onClick={() => selectVariety(v)}
                  className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors"
                  style={{ background: i === sugIdx ? "#1e1e30" : "transparent", borderBottom: "1px solid #1e1e2e" }}
                >
                  <span className="font-bold min-w-[36px]" style={{ color: "#ffd700" }}>{v.code}</span>
                  <span className="flex-1" style={{ color: "#ccc" }}>{v.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "#1a1a28", color: "#666" }}>{v.exchange}</span>
                  <span className="font-mono min-w-[50px] text-right" style={{ color: "#888" }}>{v.price ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Exchange */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px]" style={{ color: "#888" }}>Exchange</label>
          <select
            value={exchange}
            onChange={(e) => { setExchange(e.target.value); const items = varieties[e.target.value]; if (items?.length) setCode(items[0].code); }}
            className="text-xs py-1.5 px-2 rounded outline-none"
            style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0" }}
          >
            {exchangeList.map((ex) => (
              <option key={ex} value={ex}>{ex} ({varieties[ex]?.length})</option>
            ))}
          </select>
        </div>

        {/* Variety */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px]" style={{ color: "#888" }}>Variety</label>
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="text-xs py-1.5 px-2 rounded outline-none"
            style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0" }}
          >
            {varietyList.map((v) => (
              <option key={v.code} value={v.code}>{v.code} - {v.name}{v.price ? ` (${v.price})` : ""}</option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px]" style={{ color: "#888" }}>From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="text-xs py-1 px-2 rounded outline-none" style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0", colorScheme: "dark" }} />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px]" style={{ color: "#888" }}>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="text-xs py-1 px-2 rounded outline-none" style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0", colorScheme: "dark" }} />
        </div>

        {/* Period */}
        <div className="flex gap-0.5 rounded p-0.5" style={{ background: "#1a1a28" }}>
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded transition-colors"
              style={{ background: period === p.key ? "#ffd700" : "transparent", color: period === p.key ? "#0a0a0f" : "#888" }}
            >{p.label}</button>
          ))}
        </div>

        {/* Analyze + Strategy buttons — call GPT-5.4 via API */}
        <button
          onClick={async () => {
            if (!code || analyzing) return;
            const upper = code.toUpperCase();
            setAnalyzing(true);
            try {
              const res = await fetch("/api/futures/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: upper, mode: "analysis" }),
              });
              const result = await res.json();
              if (result.ok) {
                window.location.href = `/futures/${upper}/analysis`;
              } else {
                alert("Analysis failed: " + (result.error || "Unknown error"));
              }
            } catch (err) {
              alert("Analysis failed: " + String(err));
            } finally {
              setAnalyzing(false);
            }
          }}
          disabled={analyzing}
          className="px-3 py-1.5 text-xs font-semibold rounded transition-colors"
          style={{ background: analyzing ? "#555" : "#d97706", color: "#fff", border: "none", cursor: analyzing ? "wait" : "pointer" }}
        >
          {analyzing ? "Analyzing..." : "Analyze"}
        </button>
        <button
          onClick={async () => {
            if (!code || analyzing) return;
            const upper = code.toUpperCase();
            setAnalyzing(true);
            try {
              const res = await fetch("/api/futures/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: upper, mode: "strategy" }),
              });
              const result = await res.json();
              if (result.ok) {
                window.location.href = `/futures/${upper}/analysis`;
              } else {
                alert("Strategy failed: " + (result.error || "Unknown error"));
              }
            } catch (err) {
              alert("Strategy failed: " + String(err));
            } finally {
              setAnalyzing(false);
            }
          }}
          disabled={analyzing}
          className="px-3 py-1.5 text-xs font-semibold rounded transition-colors"
          style={{ background: analyzing ? "#555" : "#2563eb", color: "#fff", border: "none", cursor: analyzing ? "wait" : "pointer" }}
        >
          {analyzing ? "Generating..." : "Strategy"}
        </button>
        {code && (
          <a
            href={`/futures/${code.toUpperCase()}/analysis`}
            className="px-2.5 py-1.5 text-xs rounded transition-colors"
            style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#888" }}
          >
            View Report
          </a>
        )}

        <span className="ml-auto text-[10px]" style={{ color: "#555" }}>Powered by AKShare</span>
      </div>

      {/* ===== INFO BAR ===== */}
      <div className="flex items-center gap-4 px-4 py-1 text-xs" style={{ background: "#0e0e16", borderBottom: "1px solid #1e1e2e", minHeight: 28 }}>
        <span className="font-bold text-sm" style={{ color: "#ffd700" }}>{infoSymbol}</span>
        {info && <>
          <span style={{ color: "#888" }}>O<span className="ml-1" style={{ color: "#e0e0e0" }}>{info.open.toFixed(2)}</span></span>
          <span style={{ color: "#888" }}>H<span className="ml-1" style={{ color: "#e0e0e0" }}>{info.high.toFixed(2)}</span></span>
          <span style={{ color: "#888" }}>L<span className="ml-1" style={{ color: "#e0e0e0" }}>{info.low.toFixed(2)}</span></span>
          <span style={{ color: "#888" }}>C<span className="ml-1" style={{ color: info.close >= info.open ? "#ef5350" : "#26a69a" }}>{info.close.toFixed(2)}</span></span>
          <span style={{ color: info.close >= info.open ? "#ef5350" : "#26a69a" }}>
            {((info.close - info.open) / info.open * 100) >= 0 ? "+" : ""}{((info.close - info.open) / info.open * 100).toFixed(2)}%
          </span>
          <span style={{ color: "#888" }}>Vol<span className="ml-1" style={{ color: "#e0e0e0" }}>{fmtVol(info.volume)}</span></span>
          <span style={{ color: "#888" }}>Bars<span className="ml-1" style={{ color: "#e0e0e0" }}>{data.length}</span></span>
        </>}
        <button
          onClick={() => setShowRt(!showRt)}
          className="ml-auto text-[11px] px-2 py-0.5 rounded"
          style={{ background: showRt ? "#ffd700" : "#1a1a28", color: showRt ? "#0a0a0f" : "#888", border: "1px solid #2a2a3a" }}
        >
          Live Quotes
        </button>
      </div>

      {/* ===== REALTIME QUOTES ===== */}
      {showRt && rtData.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 overflow-x-auto" style={{ background: "#0e0e16", borderBottom: "1px solid #1e1e2e" }}>
          {rtData.map((r) => (
            <div key={r.symbol} className="flex flex-col items-center flex-shrink-0 px-2.5 py-1 rounded" style={{ background: "#12121a", border: "1px solid #1e1e2e", minWidth: 85 }}>
              <span className="text-[11px] font-bold" style={{ color: "#ffd700" }}>{r.symbol}</span>
              <span className="text-sm font-bold" style={{ color: r.change_pct > 0 ? "#ef5350" : r.change_pct < 0 ? "#26a69a" : "#888" }}>
                {r.price?.toLocaleString() ?? "—"}
              </span>
              <span className="text-[10px]" style={{ color: r.change_pct > 0 ? "#ef5350" : r.change_pct < 0 ? "#26a69a" : "#888" }}>
                {r.change_pct > 0 ? "+" : ""}{r.change_pct}%
              </span>
              <span className="text-[9px]" style={{ color: "#555" }}>
                V:{r.volume >= 1000 ? (r.volume / 1000).toFixed(0) + "K" : r.volume} OI:{r.oi >= 1000 ? (r.oi / 1000).toFixed(0) + "K" : r.oi}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ===== MAIN AREA ===== */}
      <div className="flex flex-1 min-h-0">

        {/* Draw toolbar */}
        <div className="flex flex-col items-center gap-0.5 py-1.5 flex-shrink-0" style={{ width: 40, background: "#12121a", borderRight: "1px solid #1e1e2e" }}>
          {tools.map((t, i) => (
            <div key={t.key}>
              {i === 1 && <div className="w-6 h-px my-1" style={{ background: "#1e1e2e" }} />}
              <button
                onClick={() => setCurrentTool(t.key)}
                className="w-8 h-8 flex items-center justify-center rounded transition-colors"
                style={{ background: currentTool === t.key ? "#2a2a40" : "transparent", color: currentTool === t.key ? "#ffd700" : "#888" }}
                title={t.label}
              >
                <svg viewBox="0 0 20 20" width={18} height={18} stroke="currentColor" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  {t.key === "cursor" ? <path d={t.icon} /> : t.icon.split("M").filter(Boolean).map((seg, si) => <path key={si} d={"M" + seg} />)}
                </svg>
              </button>
            </div>
          ))}
          <div className="w-6 h-px my-1" style={{ background: "#1e1e2e" }} />
          <button onClick={() => { drawingsRef.current.pop(); renderDrawings(); }} className="w-8 h-8 flex items-center justify-center rounded transition-colors" style={{ color: "#888" }} title="Undo (Ctrl+Z)">
            <svg viewBox="0 0 20 20" width={18} height={18} stroke="currentColor" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 8l4-4M4 8l4 4M5 8h8a4 4 0 010 8H9" /></svg>
          </button>
          <button onClick={() => { drawingsRef.current = []; drawStateRef.current = null; renderDrawings(); }} className="w-8 h-8 flex items-center justify-center rounded transition-colors" style={{ color: "#888" }} title="Clear All">
            <svg viewBox="0 0 20 20" width={18} height={18} stroke="currentColor" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><line x1={5} y1={5} x2={15} y2={15} /><line x1={15} y1={5} x2={5} y2={15} /></svg>
          </button>
        </div>

        {/* Chart + canvas */}
        <div ref={chartContainerRef} className="flex-1 relative overflow-hidden">
          <canvas
            ref={drawCanvasRef}
            className="absolute inset-0 z-10"
            style={{ pointerEvents: currentTool === "cursor" ? "none" : "auto", cursor: currentTool === "cursor" ? "default" : "crosshair" }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onContextMenu={(e) => { e.preventDefault(); drawStateRef.current = null; renderDrawings(); }}
          />

          {/* MA legend */}
          <div className="absolute top-2 left-3 flex gap-1.5 text-[11px] z-20">
            {maConfig.map((ma, i) => (
              <button
                key={i}
                onClick={() => {
                  const next = [...maConfig];
                  next[i] = { ...next[i], enabled: !next[i].enabled };
                  setMaConfig(next);
                  if (maSeriesRef.current[i]) {
                    (maSeriesRef.current[i] as { applyOptions: (o: { visible: boolean }) => void }).applyOptions({ visible: next[i].enabled });
                  }
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-opacity"
                style={{ opacity: ma.enabled ? 1 : 0.35 }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: ma.color }} />
                <span>MA{ma.period}</span>
              </button>
            ))}
            <button onClick={() => setShowMaPanel(!showMaPanel)} className="px-1" style={{ color: "#666" }}>&#9881;</button>
          </div>

          {/* MA config panel */}
          {showMaPanel && (
            <div className="absolute top-8 left-3 p-3 rounded-md shadow-lg z-30" style={{ background: "#16161f", border: "1px solid #2a2a3a", minWidth: 220 }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#888" }}>Moving Averages</div>
              {maConfig.map((ma, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <input type="checkbox" checked={ma.enabled} onChange={(e) => {
                    const next = [...maConfig]; next[i] = { ...next[i], enabled: e.target.checked }; setMaConfig(next);
                    if (maSeriesRef.current[i]) (maSeriesRef.current[i] as { applyOptions: (o: { visible: boolean }) => void }).applyOptions({ visible: next[i].enabled });
                  }} className="w-3.5 h-3.5" style={{ accentColor: "#ffd700" }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ma.color }} />
                  <span className="text-[11px]" style={{ color: "#aaa" }}>MA</span>
                  <input type="number" value={ma.period} min={1} max={500}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (v >= 1 && v <= 500) {
                        const next = [...maConfig]; next[i] = { ...next[i], period: v }; setMaConfig(next);
                        if (maSeriesRef.current[i] && next[i].enabled && data.length > v) {
                          (maSeriesRef.current[i] as { setData: (d: unknown[]) => void }).setData(calcMA(data, v));
                        }
                      }
                    }}
                    className="w-12 text-center text-xs py-0.5 rounded outline-none"
                    style={{ background: "#1a1a28", border: "1px solid #2a2a3a", color: "#e0e0e0" }}
                  />
                  <input type="color" value={ma.color}
                    onChange={(e) => {
                      const next = [...maConfig]; next[i] = { ...next[i], color: e.target.value }; setMaConfig(next);
                      if (maSeriesRef.current[i]) (maSeriesRef.current[i] as { applyOptions: (o: { color: string }) => void }).applyOptions({ color: next[i].color });
                    }}
                    className="w-6 h-5 p-0 border-none bg-transparent cursor-pointer"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
              <div className="w-9 h-9 border-3 rounded-full animate-spin" style={{ borderColor: "#2a2a3a", borderTopColor: "#ffd700" }} />
              <div className="text-xs mt-3" style={{ color: "#888" }}>Loading data...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

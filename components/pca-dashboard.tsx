"use client";

import { useState, useEffect, useCallback } from "react";
import type { PcaReport } from "@/lib/db";

interface Props {
  spReports: PcaReport[];
  chinaReports: PcaReport[];
  spDates: string[];
  chinaDates: string[];
}

type Tab = "SP500" | "CHINA";

function signalColor(signal: string): string {
  if (signal === "Inflow") return "var(--green)";
  if (signal === "Outflow") return "var(--red)";
  return "var(--muted)";
}

function returnColor(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return "var(--fg)";
  return n >= 0 ? "var(--green)" : "var(--red)";
}

function NetBar({ net, max }: { net: number; max: number }) {
  const pct = max > 0 ? Math.abs(net) / max : 0;
  const w = Math.min(pct * 100, 100);
  const color = net > 0 ? "var(--green)" : net < 0 ? "var(--red)" : "var(--border)";
  return (
    <div className="flex items-center gap-2 min-w-32">
      <div
        className="h-3 rounded-sm"
        style={{ width: `${w}%`, background: color, minWidth: net !== 0 ? 4 : 0 }}
      />
      <span className="text-xs font-mono" style={{ color }}>
        {net > 0 ? "+" : ""}
        {net}
      </span>
    </div>
  );
}

function PerformerTable({
  performers,
  title,
  color,
}: {
  performers: PcaReport["top_performers"];
  title: string;
  color: string;
}) {
  if (!performers?.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3" style={{ color }}>
        {title}
      </h3>
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full text-sm">
          <thead style={{ background: "var(--card)" }}>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Ticker</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Sector</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Return</th>
            </tr>
          </thead>
          <tbody>
            {performers.map((p) => (
              <tr
                key={p.rank}
                className="border-t"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-3 py-2 font-mono text-xs" style={{ color: "var(--muted)" }}>
                  {p.rank}
                </td>
                <td className="px-3 py-2 font-semibold font-mono" style={{ color: "var(--blue)" }}>
                  {p.ticker}
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
                  {p.sector}
                </td>
                <td
                  className="px-3 py-2 text-right font-mono font-semibold"
                  style={{ color: returnColor(p.return) }}
                >
                  {p.return}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectorRotationTable({
  rotation,
}: {
  rotation: PcaReport["sector_rotation"];
}) {
  if (!rotation?.length) return null;
  const maxNet = Math.max(...rotation.map((r) => Math.abs(r.net)), 1);
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Sector Rotation</h3>
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full text-sm">
          <thead style={{ background: "var(--card)" }}>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Sector</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--green)" }}>Winners</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--red)" }}>Losers</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Net Flow</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rotation.map((r) => (
              <tr
                key={r.sector}
                className="border-t"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-3 py-2 font-medium">{r.sector}</td>
                <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--green)" }}>
                  {r.winners}
                </td>
                <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--red)" }}>
                  {r.losers}
                </td>
                <td className="px-3 py-2">
                  <NetBar net={r.net} max={maxNet} />
                </td>
                <td
                  className="px-3 py-2 text-right text-xs font-semibold"
                  style={{ color: signalColor(r.signal) }}
                >
                  {r.signal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHART_LABELS: Record<string, string> = {
  scree_plot: "Variance Explained",
  biplot_winners: "Winners Biplot (PC1 vs PC2)",
  biplot_losers: "Losers Biplot (PC1 vs PC2)",
  sector_heatmap_winners: "Sector × Factor (Winners)",
  sector_heatmap_losers: "Sector × Factor (Losers)",
  cumulative_returns: "Cumulative Returns by Sector",
  biplot: "Full Universe Biplot",
  factor_loadings: "Factor Loadings",
  sector_scores: "Sector × PC Scores",
  pc1_quintile: "PC1 Quintile Returns",
};

function LazyCharts({ reportId }: { reportId: number }) {
  const [charts, setCharts] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (charts) { setExpanded(true); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/pca-charts?id=${reportId}`);
      const data = await res.json();
      setCharts(data.charts || {});
      setExpanded(true);
    } catch { setCharts({}); }
    setLoading(false);
  }, [reportId, charts]);

  return (
    <div>
      <button
        onClick={() => expanded ? setExpanded(false) : load()}
        className="text-sm font-semibold px-4 py-2 rounded-md cursor-pointer transition-colors hover:brightness-125"
        style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
      >
        {loading ? "Loading charts…" : expanded ? "▾ Hide Charts" : "▸ Show Charts"}
      </button>

      {expanded && charts && Object.keys(charts).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {Object.entries(charts).map(([key, dataUri]) => (
            <div
              key={key}
              className="rounded-lg p-3 overflow-hidden"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>
                {CHART_LABELS[key] || key.replace(/_/g, " ")}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dataUri}
                alt={CHART_LABELS[key] || key}
                className="w-full rounded"
                style={{ background: "#fff" }}
              />
            </div>
          ))}
        </div>
      )}

      {expanded && charts && Object.keys(charts).length === 0 && (
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>No charts available.</p>
      )}
    </div>
  );
}

function ReportSection({ report }: { report: PcaReport }) {
  const periodLabel =
    report.scope === "full"
      ? `Full Universe (${report.period_weeks}W)`
      : `Extremes — ${report.period_weeks}W (${Math.round(report.period_weeks / 4)}M)`;

  const metrics = report.key_metrics || {};
  const totalStocks = (metrics.total_stocks as number) || 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 flex-wrap">
        <span
          className="px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            background: report.scope === "full" ? "var(--blue)" : "var(--green)",
            color: "#fff",
            opacity: 0.9,
          }}
        >
          {periodLabel}
        </span>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {report.report_date} &middot; {totalStocks} stocks analyzed
        </span>
      </div>

      {report.scope !== "full" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerformerTable
            performers={report.top_performers}
            title="Top 10 Winners"
            color="var(--green)"
          />
          <PerformerTable
            performers={report.bottom_performers}
            title="Top 10 Losers"
            color="var(--red)"
          />
        </div>
      )}

      {report.sector_rotation?.length > 0 && (
        <SectorRotationTable rotation={report.sector_rotation} />
      )}

      <LazyCharts reportId={report.id} />
    </div>
  );
}

function RunPcaButton({ universe }: { universe: Tab }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const label = universe === "SP500" ? "S&P 500" : "China + HK";
  const apiUniverse = universe === "SP500" ? "SP500" : "CHINA";

  async function handleRun() {
    setRunning(true);
    setStatus(`Fetching ${label} stocks… 2-5 minutes`);
    try {
      const res = await fetch("/api/run-pca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe: apiUniverse }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(`Done — ${data.stocks} stocks, ${data.periods.join(" + ")}`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    setRunning(false);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRun}
        disabled={running}
        className="px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: "var(--green)", color: "#fff" }}
      >
        {running ? "Running…" : `▶ Run PCA (${label})`}
      </button>
      {status && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {status}
        </span>
      )}
    </div>
  );
}

export function PcaDashboard({ spReports, chinaReports, spDates, chinaDates }: Props) {
  const [tab, setTab] = useState<Tab>(spReports.length > 0 ? "SP500" : "CHINA");
  const reports = tab === "SP500" ? spReports : chinaReports;
  const dates = tab === "SP500" ? spDates : chinaDates;
  const hasData = reports.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        {(["SP500", "CHINA"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
            style={{
              background: tab === t ? "var(--blue)" : "var(--card)",
              color: tab === t ? "#fff" : "var(--muted)",
              border: `1px solid ${tab === t ? "var(--blue)" : "var(--border)"}`,
            }}
          >
            {t === "SP500" ? "S&P 500" : "China + HK"}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {dates.length > 0 && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Latest: {dates[0]}
              {dates.length > 1 && ` · ${dates.length} reports`}
            </span>
          )}
          <RunPcaButton universe={tab} />
        </div>
      </div>

      {!hasData ? (
        <div
          className="rounded-lg p-12 text-center space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <p className="text-lg font-medium">No PCA data yet</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Click <strong>Run PCA</strong> above to fetch live S&amp;P 500 data, or run the full Python pipeline locally.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {reports.map((r) => (
            <ReportSection key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

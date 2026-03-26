import type { WatchlistStock } from "./db";

export interface Trigger {
  level: "critical" | "warning" | "info";
  reason: string;
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 999;
  try {
    const d = new Date(dateStr);
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
  } catch {
    return 999;
  }
}

const ACTION_BUY_RE = /buy|accumulate|right-side|left-side|加仓|建仓|买入/i;

export function isActionable(action: string | null | undefined): boolean {
  return ACTION_BUY_RE.test(action || "");
}

export function detectTriggers(s: WatchlistStock): Trigger[] {
  const triggers: Trigger[] = [];
  const age = daysSince(s.created_at);
  const actionable = isActionable(s.action);

  if (age >= 90) {
    triggers.push({
      level: "critical",
      reason: `Stale analysis (${age}d old, >90d)`,
    });
  }

  if (!s.analysis_report) {
    triggers.push({
      level: "critical",
      reason: "No analysis report",
    });
  }

  if (!s.moat_width) {
    triggers.push({
      level: "warning",
      reason: "No moat assessment",
    });
  }

  if (!s.green_walls && !s.red_walls && !s.yellow_walls) {
    triggers.push({
      level: "critical",
      reason: "No wall classification",
    });
  }

  const geo = s.geometric_order;
  if (geo != null && geo >= 2 && age >= 7) {
    const label = geo === 2 ? "Acceleration" : "Jerk/Snap";
    triggers.push({
      level: geo === 3 ? "critical" : "warning",
      reason: `Geo Order ${geo} (${label}) — review exit`,
    });
  }

  const s12 = s.sector_12m_return;
  const isRight = /right/i.test(s.action || "");
  if (s12 != null && s12 < -10 && isRight && age >= 14) {
    triggers.push({
      level: "warning",
      reason: `Sector headwind (${s12.toFixed(1)}%) vs right-side action`,
    });
  }

  const gw = s.green_walls || 0;
  if (gw >= 3 && age >= 30) {
    triggers.push({
      level: "warning",
      reason: `Strong stock (${gw} green walls) — refresh recommended (${age}d old)`,
    });
  }

  if (actionable && age >= 30) {
    triggers.push({
      level: "warning",
      reason: `Actionable stock (${s.action}) — keep analysis fresh (${age}d old)`,
    });
  }

  const signalOpen = /open/i.test(s.trend_signal || "");
  const geoOrder = s.geometric_order ?? -1;
  if (signalOpen && geoOrder >= 0 && geoOrder <= 2 && (!s.analysis_report || age >= 30)) {
    const geoLabels: Record<number, string> = { 0: "Anchor", 1: "Velocity", 2: "Acceleration" };
    triggers.push({
      level: "warning",
      reason: `TrendWise Open + Geo ${geoOrder} (${geoLabels[geoOrder]}) — ${s.analysis_report ? `analysis ${age}d old` : "no analysis"}`,
    });
  }

  return triggers;
}

export function worstLevel(
  triggers: Trigger[]
): "critical" | "warning" | "info" | null {
  if (triggers.some((t) => t.level === "critical")) return "critical";
  if (triggers.some((t) => t.level === "warning")) return "warning";
  if (triggers.some((t) => t.level === "info")) return "info";
  return null;
}

import type { WatchlistStock } from "./db";

export interface ScoreBreakdown {
  walls: number;
  trendwise: number;
  clock: number;
  moat: number;
  stage: number;
  geo: number;
  sector: number;
  total: number;
  grade: string;
  gradeColor: string;
}

const MAX_WALLS = 25;
const MAX_TREND = 15;
const MAX_CLOCK = 15;
const MAX_MOAT = 15;
const MAX_STAGE = 10;
const MAX_GEO = 10;
const MAX_SECTOR = 10;

function scoreWalls(g: number, y: number, r: number): number {
  if (g === 4) return 25;
  if (g === 3 && r === 0) return 20;
  if (g === 3) return 18;
  if (g === 2 && y === 2) return 15;
  if (g === 2 && y === 1) return 12;
  if (g === 2) return 10;
  if (g === 1 && r === 0) return 8;
  if (g === 1) return 5;
  return 2;
}

function scoreTrendWise(signal: string, action: string): number {
  const isRight = /right/i.test(action);
  const isLeft = /left/i.test(action);
  const isOpen = /open/i.test(signal);

  if (isRight && isOpen) return 15;
  if (isLeft && isOpen) return 12;
  if (isOpen) return 12;
  if (isLeft && !isOpen) return 6;
  if (!signal || signal === "No Signal") return 3;
  if (isRight && !isOpen) return 0;
  return 3;
}

function parseClock(clock: string): number {
  const m = clock.match(/~?(\d+):00/);
  return m ? parseInt(m[1]) : 0;
}

function scoreClock(clock: string, phase: string): number {
  const hour = parseClock(clock);

  if (/phase\s*2/i.test(phase)) {
    if (hour >= 8 && hour <= 10) return 15;
    if (hour === 7 || hour === 11) return 12;
    return 10;
  }
  if (/phase\s*4/i.test(phase)) {
    if (hour >= 3 && hour <= 5) return 12;
    return 8;
  }
  if (/phase\s*1/i.test(phase)) return 8;
  if (/phase\s*3/i.test(phase)) {
    if (hour >= 11 || hour <= 1) return 3;
    return 5;
  }

  if (hour >= 7 && hour <= 10) return 13;
  if (hour >= 3 && hour <= 6) return 10;
  return 5;
}

function scoreMoat(width: string, trend: string): number {
  const w = (width || "").toUpperCase();
  const t = (trend || "").toUpperCase();

  if (w === "WIDE") {
    if (t === "EXPANDING") return 15;
    if (t === "STABLE") return 13;
    if (t === "ERODING") return 9;
    return 12;
  }
  if (w === "NARROW") {
    if (t === "EXPANDING") return 10;
    if (t === "STABLE") return 8;
    if (t === "ERODING") return 4;
    return 7;
  }
  return 0;
}

function scoreStage(stage: string): number {
  if (!stage) return 5;
  const m = stage.match(/stage\s*(\d)/i);
  if (!m) return 5;
  const n = parseInt(m[1]);
  if (n === 3 || n === 4) return 10;
  if (n === 2 || n === 5) return 7;
  if (n === 1) return 4;
  return 0; // Stage 6
}

function scoreGeo(order: number | null | undefined): number {
  if (order === null || order === undefined || order < 0) return 5;
  if (order === 0) return 10;
  if (order === 1) return 8;
  if (order === 2) return 3;
  return 0; // Order 3
}

function scoreSector(s: WatchlistStock): number {
  const s12 = s.sector_12m_return;
  const i12 = s.industry_12m_return;

  if (s12 === null && i12 === null && !s.sector_rank && !s.industry_rank) return 5;

  const sStrong = s12 !== null && s12 > 10;
  const sWeak = s12 !== null && s12 < -5;
  const iStrong = i12 !== null && i12 > 10;
  const iWeak = i12 !== null && i12 < -5;

  if (sStrong && iStrong) return 10;
  if (sStrong || iStrong) return 7;
  if (sWeak && iWeak) return 0;
  if (sWeak || iWeak) return 3;
  return 5;
}

function gradeFromScore(total: number): { grade: string; gradeColor: string } {
  if (total >= 80) return { grade: "Strong Buy", gradeColor: "#22c55e" };
  if (total >= 65) return { grade: "Buy", gradeColor: "#4ade80" };
  if (total >= 50) return { grade: "Watch", gradeColor: "#eab308" };
  if (total >= 35) return { grade: "Caution", gradeColor: "#f97316" };
  return { grade: "Avoid", gradeColor: "#ef4444" };
}

/**
 * Composite score with hard-gate architecture.
 *
 * FAJ Q2 2026 (Jo & Kim, "Rethinking Variable Importance in ML") validates
 * this design: unconstrained models overfit in-sample, microcaps inflate
 * signals, and some predictors carry *negative* importance. Only with
 * economic restrictions — our 7 buy conditions — can quantitative signals
 * deliver robust, out-of-sample insights. The gating order (walls → trend
 * → clock → moat → stage → geo → sector) mirrors the FAJ finding that
 * economic filters must precede statistical scoring.
 */
export function computeCompositeScore(s: WatchlistStock): ScoreBreakdown {
  const walls = scoreWalls(s.green_walls || 0, s.yellow_walls || 0, s.red_walls || 0);
  const trendwise = scoreTrendWise(s.trend_signal || "", s.action || "");
  const clock = scoreClock(s.clock_position || "", s.phase || "");
  const moat = scoreMoat(s.moat_width || "", s.moat_trend || "");
  const stage = scoreStage(s.corporate_stage || "");
  const geo = scoreGeo(s.geometric_order);
  const sector = scoreSector(s);

  let total = walls + trendwise + clock + moat + stage + geo + sector;

  const lbs = s.long_bull_score;
  if (lbs != null) {
    const lbAdj: Record<number, number> = { 6: 8, 5: 5, 4: 3, 3: 0, 2: -3, 1: -5, 0: -8 };
    total = Math.max(0, Math.min(100, total + (lbAdj[lbs] ?? 0)));
  }

  // HMM regime modifier: persistent regime + trend direction = tailwind/headwind
  // Fixed: "Flat" with high persistence in a trending stock (e.g. NVDA Flat 98.9%
  // at +69% annualized) now gets credit — uses TrendWise as direction tiebreaker.
  const hmmRegime = (s.hmm_regime || "").toLowerCase();
  const hmmP = s.hmm_persistence;
  if (hmmRegime && hmmRegime !== "n/a" && hmmP != null) {
    let hmmAdj = 0;
    if (hmmRegime.includes("bull")) {
      hmmAdj = hmmP >= 0.95 ? 5 : hmmP >= 0.90 ? 3 : 0;
    } else if (hmmRegime.includes("bear")) {
      hmmAdj = hmmP >= 0.95 ? -5 : hmmP >= 0.90 ? -3 : 0;
    } else if (hmmRegime.includes("flat") && hmmP >= 0.90) {
      const trendOpen = /open/i.test(s.trend_signal || "");
      const trendClosed = /closed/i.test(s.trend_signal || "");
      if (trendOpen) {
        hmmAdj = hmmP >= 0.95 ? 3 : 2;
      } else if (trendClosed) {
        hmmAdj = hmmP >= 0.95 ? -2 : -1;
      }
    }
    total = Math.max(0, Math.min(100, total + hmmAdj));
  }

  const { grade, gradeColor } = gradeFromScore(total);

  return { walls, trendwise, clock, moat, stage, geo, sector, total, grade, gradeColor };
}

export const SCORE_MAXES = {
  walls: MAX_WALLS,
  trendwise: MAX_TREND,
  clock: MAX_CLOCK,
  moat: MAX_MOAT,
  stage: MAX_STAGE,
  geo: MAX_GEO,
  sector: MAX_SECTOR,
  total: MAX_WALLS + MAX_TREND + MAX_CLOCK + MAX_MOAT + MAX_STAGE + MAX_GEO + MAX_SECTOR,
};

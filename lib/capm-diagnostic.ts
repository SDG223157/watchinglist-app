import type { WatchlistStock } from "./db";

export interface ClockExpectation {
  hours: string;
  phase: string;
  alphaRange: string;
  betaRange: string;
  r2Range: string;
  signature: string;
  warnings: string;
}

export const CLOCK_FRAMEWORK: ClockExpectation[] = [
  {
    hours: "1–3",
    phase: "Narrative Birth",
    alphaRange: "Turning positive, rising",
    betaRange: "Low → rising (<1)",
    r2Range: "Low (<0.3)",
    signature: "Idiosyncratic story decoupling from market",
    warnings: "High R² too early = no unique story, just riding market",
  },
  {
    hours: "4–6",
    phase: "Narrative Peak",
    alphaRange: "High positive (>15%)",
    betaRange: "Rising, often >1",
    r2Range: "Moderate (0.3–0.5)",
    signature: "Strong excess return with growing market participation",
    warnings: "α decelerating while β rising = crowding, peak forming",
  },
  {
    hours: "7–9",
    phase: "Narrative Bust",
    alphaRange: "Collapsing → negative",
    betaRange: "High (>1.5), sticky",
    r2Range: "Rising (>0.5)",
    signature: "Loses alpha but keeps beta — worst combination",
    warnings: "β stays high but α goes negative = trapped in market gravity",
  },
  {
    hours: "10–12",
    phase: "Recovery / New Cycle",
    alphaRange: "Negative but improving",
    betaRange: "Declining toward 1",
    r2Range: "High then falling",
    signature: "Rebuilding idiosyncratic story, de-correlating",
    warnings: "α still negative + high R² = still in market gravity well",
  },
];

export type DiagnosticVerdict = "VALIDATES" | "CONTRADICTS" | "MIXED" | "NO_DATA";

export interface CAPMDiagnostic {
  verdict: DiagnosticVerdict;
  expected: ClockExpectation | null;
  signals: DiagnosticSignal[];
  summary: string;
}

export interface DiagnosticSignal {
  metric: "alpha" | "beta" | "r2" | "trend";
  status: "ok" | "warning" | "contradiction";
  message: string;
}

function parseClockHour(cp: string | null): number | null {
  if (!cp) return null;
  const m = cp.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function getExpectation(hour: number): ClockExpectation {
  if (hour >= 1 && hour <= 3) return CLOCK_FRAMEWORK[0];
  if (hour >= 4 && hour <= 6) return CLOCK_FRAMEWORK[1];
  if (hour >= 7 && hour <= 9) return CLOCK_FRAMEWORK[2];
  return CLOCK_FRAMEWORK[3];
}

export function diagnoseCapm(stock: WatchlistStock): CAPMDiagnostic {
  const hour = parseClockHour(stock.clock_position);
  const a = stock.capm_alpha;
  const b = stock.capm_beta;
  const r2 = stock.capm_r2;
  const trend = stock.capm_alpha_trend;

  if (hour == null || a == null || b == null) {
    return { verdict: "NO_DATA", expected: null, signals: [], summary: "Insufficient data for CAPM-clock diagnosis" };
  }

  const exp = getExpectation(hour);
  const signals: DiagnosticSignal[] = [];

  if (hour >= 1 && hour <= 3) {
    // Narrative Birth: expect α turning positive, β low, R² low
    if (a > 0) signals.push({ metric: "alpha", status: "ok", message: `α positive (+${a.toFixed(1)}%) — narrative gaining traction` });
    else signals.push({ metric: "alpha", status: "contradiction", message: `α negative (${a.toFixed(1)}%) at clock ${hour} — narrative not generating returns yet` });

    if (b != null && b < 1) signals.push({ metric: "beta", status: "ok", message: `β < 1 (${b.toFixed(2)}) — low market exposure, idiosyncratic` });
    else if (b != null) signals.push({ metric: "beta", status: "warning", message: `β > 1 (${b.toFixed(2)}) at birth — too correlated for early narrative` });

    if (r2 != null && r2 < 0.3) signals.push({ metric: "r2", status: "ok", message: `R² low (${r2.toFixed(2)}) — stock decoupled from market` });
    else if (r2 != null) signals.push({ metric: "r2", status: "warning", message: `R² high (${r2.toFixed(2)}) at birth — no unique story, just riding market` });

  } else if (hour >= 4 && hour <= 6) {
    // Narrative Peak: expect α high, β rising, R² moderate
    if (a > 15) signals.push({ metric: "alpha", status: "ok", message: `α strong (+${a.toFixed(1)}%) — narrative in full bloom` });
    else if (a > 0) signals.push({ metric: "alpha", status: "warning", message: `α moderate (+${a.toFixed(1)}%) — expected higher at peak clock` });
    else signals.push({ metric: "alpha", status: "contradiction", message: `α negative (${a.toFixed(1)}%) at peak clock — narrative not delivering` });

    if (trend === "decelerating") signals.push({ metric: "trend", status: "warning", message: "α decelerating — peak may be forming, crowding risk" });
    else if (trend === "accelerating") signals.push({ metric: "trend", status: "ok", message: "α still accelerating — narrative momentum intact" });

    if (r2 != null && r2 > 0.5) signals.push({ metric: "r2", status: "warning", message: `R² high (${r2.toFixed(2)}) at peak — becoming market-driven, losing uniqueness` });

  } else if (hour >= 7 && hour <= 9) {
    // Narrative Bust: expect α collapsing, β high+sticky, R² rising
    if (a < -10) signals.push({ metric: "alpha", status: "ok", message: `α deeply negative (${a.toFixed(1)}%) — consistent with bust` });
    else if (a < 0) signals.push({ metric: "alpha", status: "ok", message: `α negative (${a.toFixed(1)}%) — bust confirmed` });
    else signals.push({ metric: "alpha", status: "contradiction", message: `α positive (+${a.toFixed(1)}%) at bust clock — clock may be wrong, or recovery underway` });

    if (b != null && b > 1.5) signals.push({ metric: "beta", status: "warning", message: `β high (${b.toFixed(2)}) and sticky — trapped, amplifying market losses` });
    else if (b != null && b > 1) signals.push({ metric: "beta", status: "ok", message: `β > 1 (${b.toFixed(2)}) — elevated market exposure during bust` });

    if (trend === "accelerating") signals.push({ metric: "trend", status: "ok", message: "α improving — possible early recovery signal" });

  } else {
    // Recovery (10–12): expect α negative but improving, β declining, R² falling
    if (a > 0 && trend === "accelerating") signals.push({ metric: "alpha", status: "ok", message: `α positive (+${a.toFixed(1)}%) and accelerating — recovery narrative working` });
    else if (a > 0) signals.push({ metric: "alpha", status: "ok", message: `α positive (+${a.toFixed(1)}%) — recovery generating excess returns` });
    else if (trend === "accelerating") signals.push({ metric: "alpha", status: "warning", message: `α still negative (${a.toFixed(1)}%) but improving — early recovery` });
    else signals.push({ metric: "alpha", status: "contradiction", message: `α negative (${a.toFixed(1)}%) and not improving at recovery clock — narrative stalled` });

    if (r2 != null && r2 > 0.6) signals.push({ metric: "r2", status: "warning", message: `R² still high (${r2.toFixed(2)}) — stock hasn't escaped market gravity` });
    else if (r2 != null && r2 < 0.3) signals.push({ metric: "r2", status: "ok", message: `R² dropping (${r2.toFixed(2)}) — rebuilding idiosyncratic narrative` });

    if (b != null && b < 1) signals.push({ metric: "beta", status: "ok", message: `β declining (${b.toFixed(2)}) — de-risking from market` });
    else if (b != null && b > 1.5) signals.push({ metric: "beta", status: "warning", message: `β still high (${b.toFixed(2)}) at recovery — hasn't de-leveraged from market` });
  }

  const contradictions = signals.filter((s) => s.status === "contradiction").length;
  const warnings = signals.filter((s) => s.status === "warning").length;
  const oks = signals.filter((s) => s.status === "ok").length;

  let verdict: DiagnosticVerdict;
  if (contradictions >= 2) verdict = "CONTRADICTS";
  else if (contradictions >= 1 || warnings >= 2) verdict = "MIXED";
  else verdict = "VALIDATES";

  const summary =
    verdict === "VALIDATES"
      ? `α/β/R² pattern confirms clock ${stock.clock_position} — ${exp.phase}`
      : verdict === "CONTRADICTS"
        ? `α/β/R² contradicts clock ${stock.clock_position} — check if narrative has shifted`
        : `α/β/R² partially matches clock ${stock.clock_position} — ${warnings} warning sign${warnings !== 1 ? "s" : ""}`;

  return { verdict, expected: exp, signals, summary };
}

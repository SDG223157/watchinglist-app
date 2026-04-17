import type { BounceResult, BounceRow, BounceLeaderboard } from "./bounce-leader";

const OPENAI_MODEL = "gpt-5.4";
const EDENAI_MODEL = "openai/gpt-5.4";
const OPENROUTER_MODEL = "openai/gpt-5.4";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EDENAI_URL = "https://api.edenai.run/v3/llm/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface BounceInsights {
  report: string;
  parsed: {
    narrative?: string;
    durability?: "HIGH" | "MEDIUM" | "LOW";
    top_picks?: Array<{
      ticker: string;
      thesis: string;
      conviction: "High" | "Medium" | "Speculative";
      size_hint?: string;
    }>;
    avoid?: string[];
    divergences?: string[];
    risk_flags?: string[];
  };
  model: string;
  provider: string;
  generatedAt: string;
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatLeaderboard(board: BounceLeaderboard, label: string, topN = 8, botN = 4): string {
  const sorted = [...board.rows].sort((a, b) => b.totalPct - a.totalPct);
  const top = sorted.slice(0, topN);
  const bot = sorted.slice(-botN).reverse();

  const fmtW1 = (w1: number | null | undefined) =>
    w1 == null ? "W1  —   " : `W1 ${fmtPct(w1).padStart(7)}`;

  const fmtAgreement = (ag?: string) => {
    if (!ag || ag === "NEITHER") return "";
    return `[${ag}]`;
  };

  const rows = (arr: BounceRow[]) =>
    arr
      .map(
        (r) =>
          `  ${r.ticker.padEnd(12)} ${r.name.slice(0, 28).padEnd(28)} [${r.bucket.slice(0, 18).padEnd(18)}] ` +
          `D1 ${fmtPct(r.day1Pct).padStart(7)}  ${fmtW1(r.week1Pct)}  Total ${fmtPct(r.totalPct).padStart(7)}  [${r.tier}] ${fmtAgreement(r.agreement)}`
      )
      .join("\n");

  const w1Line = board.week1Date ? ` → Week-1 ${board.week1Date}` : "";

  // List agreement counts per board
  const both = board.rows.filter((r) => r.agreement === "BOTH").map((r) => r.ticker);
  const d1Only = board.rows.filter((r) => r.agreement === "DAY1_ONLY").map((r) => r.ticker);
  const w1Only = board.rows.filter((r) => r.agreement === "WEEK1_ONLY").map((r) => r.ticker);

  return `=== ${label} ===
Benchmark ${board.benchmarkTicker}: ${fmtPct(board.benchmarkTotalPct)}
Trough ${board.troughDate} → Day-1 ${board.day1Date}${w1Line} → Latest ${board.latestDate}

Agreement tags:
  BOTH (Day-1 & Week-1 both top-tercile — highest conviction): ${both.length ? both.join(", ") : "none"}
  DAY1_ONLY (fading, led D1 but lost W1 top): ${d1Only.length ? d1Only.join(", ") : "none"}
  WEEK1_ONLY (late-joiner, missed D1 but entered W1 top): ${w1Only.length ? w1Only.join(", ") : "none"}

TOP ${topN} (leaders by Total):
${rows(top)}

BOTTOM ${botN} (laggards):
${rows(bot)}
`;
}

export function buildInsightsPrompt(data: BounceResult): string {
  const usBlock = data.us ? formatLeaderboard(data.us, "US SECTOR BOUNCE LEADERBOARD", 10, 4) : "";
  const cnBlock = data.china ? formatLeaderboard(data.china, "CHINA DOMESTIC SECTOR LEADERBOARD", 10, 4) : "";
  const qdiiBlock = data.qdii ? formatLeaderboard(data.qdii, "QDII GLOBAL ACCESS LEADERBOARD (A-share listed, RMB-denominated)", 10, 4) : "";

  const syncBlock = data.crossMarketSync ? `
=== CROSS-MARKET SYNC ===
Synchronized: ${data.crossMarketSync.synchronized ? "YES" : "NO"}
Narrative verdict: ${data.crossMarketSync.narrative}
US leader: ${data.crossMarketSync.usLeader}
China leader: ${data.crossMarketSync.chinaLeader}
US laggard: ${data.crossMarketSync.usLaggard}
China laggard: ${data.crossMarketSync.chinaLaggard}
` : "";

  return `You are a cross-market equity strategist specializing in US → China lead-lag dynamics after market corrections. Your audience is Chinese mainland investors who cannot directly buy US-listed ETFs (SMH, XLK, QQQ, etc.) due to capital controls, but CAN buy A-share listed QDII wrappers and China domestic sector ETFs.

**Core principle:** The US market closes at ~4am China time, roughly 5 hours before A-share open. Whatever the US does on Day-1 of a bounce becomes the leading indicator for Asia's positioning the same morning. QDII ETFs gap open to reflect US moves, creating a pricing event. Chinese domestic sectors either follow the US leader or lag it — the lag window is where catch-up alpha lives.

**Two signals — Day-1 (fast) and Week-1 (stable):**
- **Day-1** = single-session reaction. Fast but noisy. Best for normal drawdowns (-5% to -15%).
- **Week-1** = return over the first 5 sessions after the trough. Slower but filters out single-day short-cover noise. Best for violent bottoms (≥-20% or Day-1 ≥+5%).
- **Agreement** between the two signals (BOTH tag) is the highest-conviction indicator per our FAJ paper empirical work. Agreement correlation ρ=0.59 across 67 events means they disagree about 40% of the time — and the 60% where they agree is where structural winners concentrate.
- **Fading** (DAY1_ONLY): led Day-1 but dropped from Week-1 top = short-cover noise, consider trimming.
- **Late-joiner** (WEEK1_ONLY): missed Day-1 top but entered Week-1 top = IWM-April-2025 pattern (rank 9→3 → +44% phase).

**Honest caveat:** Pure-forward (excluding formation overlap), neither Day-1 nor Week-1 predicts forward returns at individual event level (FAJ paper Table 5-6). What works is the **structural-winner tilt** (SMH/XLK/QQQ/IWM lead on average across events; XLU/XLP/XLV lag on average). Use Day-1 & Week-1 as REGIME-CONFIRMATION: if structural winners lead → standard bull continuation, tilt to structural winners. If defensives lead → Daniel-Moskowitz momentum-crash warning, reduce risk.

**Historical analog:** April 9, 2025 Liberation Day rebound — US semis (SMH) led Day-1 at +17.2% AND Week-1 at +22.1% (BOTH agreement) and delivered +138% by Feb 2026 (Spearman rank correlation 0.79 between Day-1 and phase rank). Chinese semis (512480, 588200) followed with a 1-2 day lag and delivered +100%+ during the same phase.

${usBlock}${cnBlock}${qdiiBlock}${syncBlock}

=== YOUR TASK ===

Produce a markdown report titled "## Cross-Market Bounce Insights — US Leading → China Positioning" with these 6 sections:

### 1. Narrative Diagnosis
Identify the single dominant narrative driving the bounce from the US leaderboard pattern. Choose from:
- **AI / Semis Reflation** (SMH, XLK lead)
- **Broad Risk-On Reflation** (IWM, XLI, XLB lead with semis)
- **Defensive / Bear-Market Rally** (XLP, XLU, XLV lead — usually short-lived)
- **Cyclical Recovery** (XLF, XLI, XLB, XLE lead without tech)
- **Mixed / No Clear Narrative**

State the durability verdict: **HIGH** (synchronized across markets, narrative has capital backing), **MEDIUM** (partial sync, some leadership but not broad), **LOW** (defensive-led or divergent — likely a bear rally).

### 2. US → China / QDII Translation Table
For each of the TOP 5 US sectors, identify the best A-share QDII ticker AND the best China domestic sector ticker that trades the same theme. Format:

| US Leader (Day-1 / Total) | QDII Ticker (A-share) | China Domestic Ticker | Conviction | Lag Status |
|---|---|---|---|---|

Lag Status options: "Already caught up" / "Lagging — catch-up opportunity" / "Over-run US — reduce"

### 3. High-Conviction Trade Ideas (3-5 ideas)
Produce concrete trade ideas specifically for Chinese mainland investors (prioritize QDII + A-share tickers they can actually buy). **Prioritize tickers with BOTH agreement tag (top-tercile on both Day-1 and Week-1) — these are the structural-winner signals with highest conviction.** Only include DAY1_ONLY or WEEK1_ONLY tickers if the BOTH set is thin; flag the weaker signal explicitly.

For each idea:
- **Ticker + Chinese Name** (e.g. 513310 中韩半导体)
- **Agreement tag** (BOTH / DAY1_ONLY / WEEK1_ONLY) — state the tag and what it implies
- **Thesis** in 2-3 sentences grounded in the leaderboard data
- **Conviction**: High (BOTH) / Medium (one signal only) / Speculative
- **Entry hint**: e.g. "buy at open day after US Day-1 +3%", "wait for pullback to IOPV premium <3%"
- **Size hint**: e.g. "full position (BOTH agreement)", "half position (DAY1_ONLY, risk of fade)"

Rank by conviction descending. BOTH tags go first.

### 4. Cross-Market Divergences (Catch-Up vs Fade Opportunities)
Find 2-4 explicit mismatches where US and China leadership diverged. For each:
- Describe the divergence quantitatively (e.g. "SMH +25%, 512480 +16% — China semis lag by 9pp")
- State whether it's a **catch-up opportunity** (China under-reacted, expect it to close the gap) OR **fade signal** (China over-reacted, mean-reversion likely)
- Give a specific trade (long 512480 / short 159928, for example)

### 5. Risk Flags
List 3-5 concrete risks that could invalidate the pattern:
- Macro events (Fed meeting, BOJ intervention)
- China-specific policy (PBoC, regulatory actions on tech/property)
- IOPV premium spikes on QDII (common when flows get hot)
- Narrative breakdown signals (e.g. defensive sectors starting to lead)
- Time horizon breakdown (pattern holds 5-20 sessions; after that regime can shift)

### 6. Execution Calendar (concrete day-by-day playbook)
Given today's US Day-1, what to do over the next 1/3/5/10 trading days:
- **Today (US Day-1 close)**: QDII tickers that will gap up tomorrow — size accordingly
- **Tomorrow (China T+1)**: A-share domestic sectors that will follow — watchlist
- **Week 1 (5 sessions)**: monitor which sectors confirm leadership vs fade
- **Week 2 (10 sessions)**: half-cycle check — is the pattern still intact?

Finally output a JSON block (fenced with \`\`\`json) containing:
{
  "narrative": "AI / Semis Reflation",
  "durability": "HIGH",
  "top_picks": [
    {"ticker": "513310", "thesis": "China-Korea semis = SMH proxy, lagging US +9pp", "conviction": "High", "size_hint": "1/2 position"},
    ...
  ],
  "avoid": ["512690 Baijiu — Day-1 flat, no bounce", "..."],
  "divergences": ["US semis +25% vs China semis +16% = 9pp catch-up", "..."],
  "risk_flags": ["Fed meeting next Wednesday", "QDII premiums may spike >10%", "..."]
}

Keep the report concise and actionable. No fluff. Specific tickers everywhere. Every claim grounded in the leaderboard data.`;
}

async function callLlm(prompt: string): Promise<{ text: string; provider: string }> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const edenaiKey = process.env.EDENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  const MAX_RETRIES = 2;

  if (openaiKey) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 6000,
          temperature: 0.3,
        }),
      });
      const text = await res.text();
      const isHtml = text.trimStart().startsWith("<");
      if (res.ok && !isHtml) {
        const j = JSON.parse(text);
        return { text: j.choices?.[0]?.message?.content || "", provider: "openai" };
      }
      if (isHtml && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  if (edenaiKey) {
    const res = await fetch(EDENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${edenaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EDENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 6000,
        temperature: 0.3,
      }),
    });
    const text = await res.text();
    if (res.ok && !text.trimStart().startsWith("<")) {
      const j = JSON.parse(text);
      return { text: j.choices?.[0]?.message?.content || "", provider: "edenai" };
    }
  }

  if (openrouterKey) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "HTTP-Referer": "https://watchinglist.app",
        "X-Title": "WatchingList",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 6000,
        temperature: 0.3,
      }),
    });
    const text = await res.text();
    if (res.ok) {
      const j = JSON.parse(text);
      return { text: j.choices?.[0]?.message?.content || "", provider: "openrouter" };
    }
  }

  throw new Error("No LLM provider available (set OPENAI_API_KEY / EDENAI_API_KEY / OPENROUTER_API_KEY)");
}

export async function generateInsights(data: BounceResult): Promise<BounceInsights> {
  const prompt = buildInsightsPrompt(data);
  const { text: report, provider } = await callLlm(prompt);
  if (!report) throw new Error("Empty LLM response");

  let parsed: BounceInsights["parsed"] = {};
  const jsonMatch = report.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      // JSON parse failed — return report anyway, empty parsed
    }
  }

  return {
    report,
    parsed,
    model: OPENAI_MODEL,
    provider,
    generatedAt: new Date().toISOString(),
  };
}

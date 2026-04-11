import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, getCachedHeatmap, fetchStock } from "@/lib/db";
import { buildHeatmapLookup, matchStock, type StockHeatmapContext } from "@/lib/heatmap-match";
import type { WatchlistStock } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";
import { cachedQuote, cachedSummary, cachedHistorical } from "@/lib/yf-cache";
import { refreshStockData } from "@/lib/refresh-stock";
import { computeEntropyProfile } from "@/lib/entropy";
import { computeTailDependence } from "@/lib/copula";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OPENAI_MODEL = "gpt-4.1";
const EDENAI_MODEL = "openai/gpt-4.1";
const OPENROUTER_MODEL = "openai/gpt-5.4";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EDENAI_URL = "https://api.edenai.run/v3/llm/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function fmtReturn(v: number | null): string {
  if (v == null) return "N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function buildSectorBlock(hm: StockHeatmapContext): string {
  if (!hm.sector && !hm.industry) return "Sector/Industry data: Not available\n";

  let block = "";
  if (hm.sector) {
    block += `Sector: ${hm.sector.name}\n`;
    block += `  3M Return: ${fmtReturn(hm.sector.return_3m)} | 6M: ${fmtReturn(hm.sector.return_6m)} | 12M: ${fmtReturn(hm.sector.return_12m)}\n`;
    block += `  Momentum: ${hm.sector.momentum || "N/A"}`;
    if (hm.sector.shift != null) block += ` (shift: ${hm.sector.shift >= 0 ? "+" : ""}${hm.sector.shift.toFixed(1)}pp)`;
    block += "\n";
    if (hm.sector.rank != null) block += `  Sector Rank: #${hm.sector.rank}\n`;
  }
  if (hm.industry) {
    block += `Sub-Industry: ${hm.industry.name}\n`;
    block += `  3M Return: ${fmtReturn(hm.industry.return_3m)} | 6M: ${fmtReturn(hm.industry.return_6m)} | 12M: ${fmtReturn(hm.industry.return_12m)}\n`;
    if (hm.industry.momentum) block += `  Momentum: ${hm.industry.momentum}`;
    if (hm.industry.shift != null) block += ` (shift: ${hm.industry.shift >= 0 ? "+" : ""}${hm.industry.shift.toFixed(1)}pp)`;
    if (hm.industry.momentum) block += "\n";
    if (hm.industry.rank != null) block += `  Industry Rank: #${hm.industry.rank}\n`;
  }
  return block;
}

function buildPrompt(
  quote: Record<string, unknown>,
  hist: { close: number; date: string }[],
  hm: StockHeatmapContext,
  entropyBlock: string = ""
): string {
  const symbol = quote.symbol;
  const price = quote.regularMarketPrice;
  const pe = quote.trailingPE ?? "N/A";
  const pb = quote.priceToBook ?? "N/A";
  const mc = quote.marketCap ? `$${(Number(quote.marketCap) / 1e9).toFixed(1)}B` : "N/A";
  const sector = quote.sector ?? "N/A";
  const industry = quote.industry ?? "N/A";
  const h52 = quote.fiftyTwoWeekHigh ?? "N/A";
  const l52 = quote.fiftyTwoWeekLow ?? "N/A";
  const beta = quote.beta ?? "N/A";
  const divYield = quote.dividendYield ? `${(Number(quote.dividendYield) * 100).toFixed(2)}%` : "N/A";
  const eps = quote.epsTrailingTwelveMonths ?? "N/A";
  const opMargin = quote.operatingMargins ? `${(Number(quote.operatingMargins) * 100).toFixed(1)}%` : "N/A";
  const profitMargin = quote.profitMargins ? `${(Number(quote.profitMargins) * 100).toFixed(1)}%` : "N/A";
  const roe = quote.returnOnEquity ? `${(Number(quote.returnOnEquity) * 100).toFixed(1)}%` : "N/A";
  const de = quote.debtToEquity ?? "N/A";
  const revGrowth = quote.revenueGrowth ? `${(Number(quote.revenueGrowth) * 100).toFixed(1)}%` : "N/A";
  const earnGrowth = quote.earningsGrowth ? `${(Number(quote.earningsGrowth) * 100).toFixed(1)}%` : "N/A";

  const ath = hist.length > 0 ? Math.max(...hist.map(h => h.close)) : h52;
  const distAth = ath && price ? `${(((Number(price) - Number(ath)) / Number(ath)) * 100).toFixed(1)}%` : "N/A";

  const sectorBlock = buildSectorBlock(hm);

  return `You are a senior investment analyst using the Narrative Cycle x Gravity Wall x Extreme Reversal framework.

Analyze ${quote.shortName || symbol} (${symbol}) using the data below and produce a STRUCTURED ANALYSIS REPORT in markdown.

=== STOCK DATA ===
Symbol: ${symbol}
Name: ${quote.shortName || quote.longName || symbol}
Sector: ${sector}
Industry: ${industry}
Price: ${price}
Market Cap: ${mc}
52W High: ${h52}
52W Low: ${l52}
Distance from ATH: ${distAth}
PE Ratio: ${pe}
P/B: ${pb}
EPS: ${eps}
Beta: ${beta}
Dividend Yield: ${divYield}
Operating Margin: ${opMargin}
Profit Margin: ${profitMargin}
ROE: ${roe}
Debt/Equity: ${de}
Revenue Growth: ${revGrowth}
Earnings Growth: ${earnGrowth}

=== SHANNON ENTROPY ===
${entropyBlock}
=== SECTOR & INDUSTRY CONTEXT ===
${sectorBlock}
Interpretation guide:
- Strong sector (12M > +15%) + strong industry = tailwind — upgrade position size
- Weak sector (12M < -5%) + weak industry = headwind — downgrade or require stronger stock-level conviction
- Strong sector but weak industry = stock is underperforming peers — flag risk
- Weak sector but strong industry = niche strength — potential alpha
- Momentum "Accelerating" = sector/industry gaining relative strength
- Momentum "Decelerating" = sector/industry losing steam, even if absolute returns are positive
- Sector shift > +3pp = meaningful acceleration; < -3pp = meaningful deceleration

=== FRAMEWORK ===

**Market Clock (Phase 1-4):**
- Phase 1 (6:00): Valley of Despair
- Phase 2 (7:00-11:00): Recovery/Acceleration
- Phase 3 (11:00-1:00): Saturation/Crowded Top
- Phase 4 (1:00-5:00): Collapse

**Corporate Clock (Damodaran Stages 1-6):**
1-Startup, 2-Young Growth, 3-High Growth, 4-Mature Growth, 5-Mature Stable, 6-Decline

**Damodaran Five Walls (FAJ: Foerster 2017 — FCF elevated to primary wall):**
- Revenue Growth: >10% good, 5-10% mediocre, <5% bad
- Operating Margins: >15% good, 8-15% mediocre, <8% bad
- Capital Efficiency (ROIC): >12% good, 6-12% mediocre, <6% bad
- Discount Rates (PE): trend inverted — lower PE = favorable
- Cash Conversion (FCF): FCF/Revenue >15% good, 8-15% mediocre, <8% bad

Color each: GREEN (good+stable/accel), YELLOW (mixed), RED (bad+stable/decel)

**FAJ Momentum Decomposition (Gérard/Jehl 2025):**
Earnings-driven momentum NEVER reverses (30yr evidence). Factor-only momentum DOES reverse.
- Earnings growth >5% TTM + price rising → "Structural" winner (high conviction)
- Price rising but earnings <5% → "Factor-only" (crowding risk)
- Earnings >5% but price not rising → "Fundamental" (market late)
Comment on momentum type in your buy_reason.

**FAJ Fundamental Growth (Arnott/Harvey 2026):**
R&D growth > CAPEX growth for identifying true growth companies (alpha 1.9% vs 0.7%).
Gross profit growth > net income growth (alpha 1.4% vs 0.7%).
Revenue × Discount wall interaction matters:
- Both GREEN = "Best Quadrant" (cheap + fast-growing, strongest expected returns)
- Both RED = "Worst Quadrant" (expensive + slow-growing, t-stat = -2.9, avoid)
Assess the wall_combo in your analysis and flag Best/Worst Quadrant prominently.

**FAJ CAPEX Quality (Titman 2004, Cooper 2008, Wei/Xie 2008):**
- Total asset growth >20% YoY = strongest negative predictor of future returns (Cooper: -20%/yr)
- High CAPEX + high FCF + low debt = empire building risk (Titman: managers overinvest)
- Low accrual quality (OCF/NI < 0.5) + high CAPEX = worst combination (Wei/Xie: -12% alpha)
Flag any CAPEX risk concerns prominently in your analysis.

**Extreme Scan (score each 1-5, total /20):**
- Industry bubble, Macro & valuation, Liquidity, Sentiment

**Moat Analysis (Buffett/Dorsey Framework):**
Identify the company's competitive advantages from these 5 sources:
- Network Effects: Does usage by one customer increase value for others?
- Switching Costs: How painful/expensive is it to leave for a competitor?
- Intangible Assets: Brands, patents, licenses, regulatory advantages?
- Cost Advantages: Scale economies, process advantages, resource access?
- Efficient Scale: Does the market only support a limited number of players?

Rate each: STRONG / MODERATE / WEAK / NONE
Overall Moat Width: WIDE (2+ strong sources) / NARROW (1 strong or 2+ moderate) / NONE
Moat Trend: EXPANDING / STABLE / ERODING

**Narrative Cycle History (Concentric Circles):**
Map the company's full narrative history as concentric circles — each major boom/bust cycle is one ring.
For EACH cycle, identify:
- The specific catalyst that launched it (technology shift, regulation, macro wave)
- The peak narrative / market belief at the top
- What broke it (competition, regulation, macro, internal failure)
- Peak market cap and drawdown percentage
- What permanent infrastructure survived the crash (assets, capabilities, market position)
- Whether the floor of each cycle was above or below the prior cycle's peak (expansion vs contraction)

This is the MOST IMPORTANT section — it reveals the company's structural trajectory and whether each crash destroyed or deposited value.

**Shannon Entropy (Informational Compression Meta-Layer):**
Shannon entropy measures the informational diversity of return distributions.
- H(60d) normalized [0,1]: low = one dominant force, high = diverse information processing
- Percentile ≤20th = "compressed" regime (narrative crowding or panic)
- Percentile ≥80th = "diverse" regime (healthy information environment)
- Cognitive Gap (0-10): how many "bits" the market leaves unprocessed. Score 7+ = severe.
- Anchor Failure: low entropy + price far from valuation anchors = most actionable signal.

How entropy modifies your analysis:
- Compressed regime: walls/moat/clock may be TEMPORARILY IRRELEVANT — market not processing fundamentals. Recommend smaller sizing or patience.
- Diverse regime: signals are reliable — full conviction from composite score is appropriate.
- Anchor Failure = HIGHEST PRIORITY finding: call out prominently.
- Cross-reference with HMM: Bull + compressed = fragile mania. Bear + compressed = potential reversal setup.

**HMM × Entropy Portfolio Sizing (backtest-validated):**
The HMM regime determines IF to hold. Entropy conviction determines HOW MUCH.
Kelly fraction = edge / variance, quarter-Kelly cap.
- STANDARD conviction: normal position size (1.0x)
- ELEVATED: slightly larger (1.1x) — mild entropy edge
- HIGH: 1.3x AND can enter 1/4 position even without TrendWise (tiered entry)
- MAXIMUM: 1.5x AND can enter 1/2 position without TrendWise — strongest signal
TrendWise lags ~40 days (backtest on 002475.SZ). HIGH conviction signals averaged +32.9% in 60d but TW was always Closed at the bottom. Tiered entry fixes this.
Include a "Portfolio Sizing Recommendation" in your analysis that states the conviction level, whether this is an early or confirmed entry, and the recommended size fraction.

**7 Buy Conditions:**
1. >=3 GREEN walls
2. Market Clock favorable
3. Corporate Stage 2-5
4. Geometric Order <= 1
5. Formula weight >= 2%
6. TrendWise alignment
7. Sector/industry tailwind (at least neutral — not both declining)

=== OUTPUT ===

Produce a markdown report with these sections:

## ${quote.shortName || symbol} (${symbol}) — Analysis Report

**Price / 52W / ATH / Core narrative / Phase / Clock / Corporate Stage / Confidence**

### Narrative Cycle History
Map ALL major narrative cycles as concentric circles. For each cycle:
| Cycle | Period | Catalyst | Peak Narrative | What Broke It | Peak MCap | Drawdown | Infrastructure Deposited |
Include a final row for the CURRENT cycle with your diagnosis of where we are.
After the table, write a **Concentric Circle Diagnosis**: is the company in Expansion (each cycle floor above prior peak), Recovery, Maturity, or Decline? This determines the structural trajectory.

### Sector & Industry Assessment
Evaluate whether the sector and sub-industry are providing tailwind or headwind.
Include 3M/6M/12M returns, momentum direction, and rank. State clearly: TAILWIND / NEUTRAL / HEADWIND.

### Competitive Moat
| Moat Source | Rating | Evidence |
Table with STRONG/MODERATE/WEAK/NONE for each of: Network Effects, Switching Costs, Intangible Assets, Cost Advantages, Efficient Scale.
**Moat Width: WIDE/NARROW/NONE** | **Trend: EXPANDING/STABLE/ERODING**
Key moat sources summary (the 2-3 most important competitive advantages in plain language).

### Gravity Check (Damodaran's Four Walls)
| Wall | Status | Evidence |
Table with GREEN/YELLOW/RED + data

**Score: X Green / Y Yellow / Z Red**

### Extreme Scan (/20)
| Dimension | Score /5 | Evidence |
Table

### Shannon Entropy × HMM Analysis
| Metric | Value | Interpretation |
Analyze the entropy AND HMM data provided together. Include:
- Entropy regime (compressed/normal/diverse) and what it means for this stock right now
- HMM regime (Bull/Flat/Bear) and persistence — is the neighborhood safe?
- Cognitive computation gap assessment — how many bits is the market ignoring?
- Anchor failure check (if applicable) — is the market blind AND the price wrong?
- **Conviction Level:** State MAXIMUM/HIGH/ELEVATED/STANDARD and the multiplier
- **HMM × Entropy Cross-Reference:** Use the exact cross-reference provided (fragile mania / potential reversal / healthy bull / hidden opportunity)
- **Signal Reliability Assessment:** Based on entropy, are fundamental signals currently being processed by the market?

### Copula Tail Dependence
If copula data is provided, analyze:
- Lower tail λL (co-crash probability): how much does this stock amplify market crashes?
- Asymmetry (λL − λU): is crash coupling worse than rally coupling?
- Tail regime: crash-coupled / symmetric / rally-coupled / independent
- **If crash-coupled AND near ATH:** explicitly flag as elevated risk — diversification fails when you need it most
- **If independent (low λL + λU):** flag as genuine diversifier — holds up in drawdowns
- Compare Pearson ρ (linear) vs λL (tail): if λL >> ρ, the stock looks safe on normal days but amplifies crashes

### Portfolio Sizing Recommendation
Based on the HMM × Entropy + Copula analysis:
- State the conviction level and multiplier (e.g. "HIGH conviction → 1.3x")
- State the entry type: Confirmed (TW Open), Early tiered (HIGH/MAXIMUM without TW), or Wait
- State the recommended position size fraction (full / 1/2 / 1/4 / wait)
- If anchor failure: flag as MAXIMUM priority — "the market is blind AND the price is wrong"
- If TrendWise is Closed but conviction is HIGH+: recommend tiered early entry with specific size
- If crash-coupled: reduce position by 15% ("tail risk haircut")

### Position Assessment
7 buy conditions check (including sector/industry, entropy regime, and HMM regime), recommended action (buy/watch/avoid), position size suggestion.
If sector/industry is a headwind, explicitly state how it modifies the position size or conviction level.
If entropy is compressed, explicitly state whether this creates opportunity (conviction HIGH+) or danger (fragile mania).

### Key Risks
Top 3 risks (include sector/industry risk if applicable)

### Investment Thesis
2-3 paragraph thesis incorporating narrative cycle history and sector/industry context.
Reference the concentric circle diagnosis — is this a company that deposits infrastructure through each crash, or one that destroys value?

Also output a JSON block at the end (fenced with \`\`\`json) containing:
{
  "clock_position": "~X:00",
  "phase": "Phase N ...",
  "corporate_stage": "Stage N ...",
  "narrative_cycle_history": "C1(YYYY-YYYY): [catalyst] → [peak narrative] → [what broke it]. Peak MCap ~$XXXB, drawdown -XX%. Infrastructure: [what survived]. | C2(YYYY-YYYY): ... | C3(current): ...",
  "wall_revenue": "... (GREEN/YELLOW/RED)",
  "wall_margins": "... (GREEN/YELLOW/RED)",
  "wall_capital": "... (GREEN/YELLOW/RED)",
  "wall_discount": "... (GREEN/YELLOW/RED)",
  "wall_fcf": "FCF/Rev X% + trend (GREEN/YELLOW/RED)",
  "wall_combo": "Best Quadrant / Worst Quadrant / Growth Overpriced / Value Trap Risk / Mixed",
  "green_walls": N,
  "yellow_walls": N,
  "red_walls": N,
  "extreme_score": N,
  "moat_type": "Network Effects + Switching Costs (list the primary moat sources)",
  "moat_width": "WIDE / NARROW / NONE",
  "moat_trend": "EXPANDING / STABLE / ERODING",
  "moat_sources": "2-3 sentence summary of key competitive advantages",
  "sector_signal": "TAILWIND / NEUTRAL / HEADWIND",
  "action": "buy X% / watch / avoid",
  "buy_reason": "summary of 7 conditions",
  "notes": "concentric circle life state + key insight",
  "narrative": "one paragraph current narrative incorporating cycle position"
}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const edenaiKey = process.env.EDENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openaiKey && !edenaiKey && !openrouterKey) {
    return NextResponse.json(
      { error: "No LLM API key configured (OPENAI/EDENAI/OPENROUTER)" },
      { status: 500 }
    );
  }

  const body = await req.json();
  const symbol = (body.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  }

  try {
    // Refresh price data first (includes CAPM computation)
    await refreshStockData(symbol).catch(() => {});

    // Fetch Yahoo data for the LLM prompt
    const [quote, summary, heatmapRows] = await Promise.all([
      cachedQuote(symbol),
      cachedSummary(symbol),
      getCachedHeatmap(),
    ]);
    if (!quote?.regularMarketPrice) {
      return NextResponse.json({ error: `No data for ${symbol}` }, { status: 404 });
    }
    const profile = summary?.assetProfile || {};
    const finData = summary?.financialData || {};
    quote.sector = quote.sector || profile.sector;
    quote.industry = quote.industry || profile.industry;
    quote.operatingMargins = finData.operatingMargins;
    quote.profitMargins = finData.profitMargins;
    quote.returnOnEquity = finData.returnOnEquity;
    quote.debtToEquity = finData.debtToEquity;
    quote.revenueGrowth = finData.revenueGrowth;
    quote.earningsGrowth = finData.earningsGrowth;
    quote.beta = quote.beta || summary?.defaultKeyStatistics?.beta;
    quote.priceToBook = quote.priceToBook || summary?.defaultKeyStatistics?.priceToBook;

    let hist: { close: number; date: string }[] = [];
    const rawHist = await cachedHistorical(symbol, "2020-01-01", "1wk");
    if (rawHist.length > 0) {
      hist = rawHist.map((r: { close: number; date: Date }) => ({
        close: r.close,
        date: r.date?.toISOString?.() ?? "",
      }));
    }

    // Compute Shannon entropy from 3-year daily history
    let entropyBlock = "Shannon Entropy: Not available (insufficient history)\n";
    try {
      const period3y = new Date();
      period3y.setFullYear(period3y.getFullYear() - 3);
      const dailyHist = await cachedHistorical(symbol, period3y.toISOString().split("T")[0], "1d") as { close: number; volume: number; date: Date }[];
      if (dailyHist.length >= 120) {
        const existingStock = await fetchStock(symbol);
        const entropyProfile = computeEntropyProfile(
          dailyHist.map(h => h.close),
          dailyHist.map(h => h.volume),
          dailyHist.map(h => h.date instanceof Date ? h.date.toISOString().split("T")[0] : String(h.date).split("T")[0]),
          existingStock ? {
            pe_ratio: existingStock.pe_ratio,
            price_to_book: existingStock.price_to_book,
            price: existingStock.price,
            distance_from_ath: existingStock.distance_from_ath,
            green_walls: existingStock.green_walls,
            yellow_walls: existingStock.yellow_walls,
            red_walls: existingStock.red_walls,
            geometric_order: existingStock.geometric_order,
            hmm_regime: existingStock.hmm_regime,
          } : undefined
        );
        // Compute conviction level
        const eRegime = entropyProfile.regime || "normal";
        const eCog = entropyProfile.cogGap || 0;
        const eAnchor = entropyProfile.anchorFailure || false;
        let conviction = "STANDARD";
        let convMultiplier = "1.0x";
        if (eRegime === "compressed" && eAnchor) { conviction = "MAXIMUM"; convMultiplier = "1.5x"; }
        else if (eRegime === "compressed" && eCog >= 5) { conviction = "HIGH"; convMultiplier = "1.3x"; }
        else if (eRegime === "compressed") { conviction = "ELEVATED"; convMultiplier = "1.1x"; }
        else if (eRegime === "diverse") { conviction = "NORMAL"; convMultiplier = "1.0x"; }

        // HMM data from existing DB record
        const hmmRegime = existingStock?.hmm_regime || "N/A";
        const hmmPersist = existingStock?.hmm_persistence;
        const hmmStr = hmmPersist != null ? `${hmmRegime} (${(hmmPersist * 100).toFixed(0)}% persistence)` : hmmRegime;

        // Tiered entry assessment
        const twSignal = existingStock?.trend_signal || "N/A";
        const twOpen = (twSignal || "").toLowerCase().includes("open");
        let entryType = "Standard";
        let entrySize = "Full";
        if (twOpen) {
          entryType = "Confirmed"; entrySize = "Full position";
        } else if (conviction === "MAXIMUM") {
          entryType = "Early (tiered)"; entrySize = "1/2 position — MAXIMUM conviction overrides TW lag";
        } else if (conviction === "HIGH") {
          entryType = "Early (tiered)"; entrySize = "1/4 position — HIGH conviction overrides TW lag";
        } else {
          entryType = "Wait"; entrySize = "No entry — wait for TrendWise confirmation";
        }

        entropyBlock = `Shannon Entropy (informational compression analysis):
  H(60d): ${entropyProfile.current60d?.toFixed(3) ?? "N/A"} (normalized [0,1])
  H(120d): ${entropyProfile.current120d?.toFixed(3) ?? "N/A"}
  H(252d): ${entropyProfile.current252d?.toFixed(3) ?? "N/A"}
  Volume Entropy: ${entropyProfile.volumeEntropy60d?.toFixed(3) ?? "N/A"}
  Percentile (full): ${entropyProfile.percentile?.toFixed(0) ?? "N/A"}%
  Percentile (1Y): ${entropyProfile.percentile1y?.toFixed(0) ?? "N/A"}% (vs last 252 trading days)
  Percentile (3Y): ${entropyProfile.percentile3y?.toFixed(0) ?? "N/A"}% (vs last 756 trading days)
  Trend: ${entropyProfile.trend != null ? (entropyProfile.trend >= 0 ? "+" : "") + (entropyProfile.trend * 1000).toFixed(2) : "N/A"} (×1000, negative = compressing)
  Regime: ${entropyProfile.regime}
  Cognitive Gap: ${entropyProfile.cogGap}/10 (${entropyProfile.cogGapLabel})
  Anchor Failure: ${entropyProfile.anchorFailure ? "YES — " + entropyProfile.anchorDetail : "No"}

HMM Regime: ${hmmStr}
TrendWise: ${twSignal}
Conviction Level: ${conviction} (${convMultiplier} position size multiplier)
Entry Assessment: ${entryType} — ${entrySize}

Cross-Reference:
  HMM ${hmmRegime} + Entropy ${eRegime} = ${
    hmmRegime === "Bull" && eRegime === "compressed" ? "FRAGILE MANIA — Bull trend but narrative crowded. Proceed with caution, size via Kelly."
    : hmmRegime === "Bear" && eRegime === "compressed" ? "POTENTIAL REVERSAL — everyone positioned the same way. Watch for TrendWise Open."
    : hmmRegime === "Bull" && eRegime === "diverse" ? "HEALTHY BULL — market processing information well. Full conviction from composite score."
    : hmmRegime === "Flat" && eRegime === "compressed" ? "HIDDEN OPPORTUNITY — market blind in uncertain regime. Tiered entry if conviction is HIGH+."
    : "Standard environment — no special entropy/regime interaction."
  }
`;

        // Copula tail dependence
        try {
          const benchSymbol = symbol.endsWith(".HK") ? "^HSI" : symbol.endsWith(".SS") || symbol.endsWith(".SZ") ? "000300.SS" : "SPY";
          const benchHist = await cachedHistorical(benchSymbol, period3y.toISOString().split("T")[0], "1d") as { close: number; date: Date }[];
          const stockPrices = dailyHist.map(h => h.close).filter((v): v is number => v != null && !Number.isNaN(v));
          const benchPrices = benchHist.map(h => h.close).filter((v): v is number => v != null && !Number.isNaN(v));
          const stockRet = stockPrices.slice(1).map((v, i) => Math.log(v / stockPrices[i]));
          const benchRet = benchPrices.slice(1).map((v, i) => Math.log(v / benchPrices[i]));
          if (stockRet.length > 60 && benchRet.length > 60) {
            const tail = computeTailDependence(stockRet, benchRet);
            entropyBlock += `\nCopula Tail Dependence (how stock co-moves with benchmark in extreme tails):
  Lower tail λL: ${tail.lowerTail.toFixed(3)} (co-crash probability — Clayton copula)
  Upper tail λU: ${tail.upperTail.toFixed(3)} (co-rally probability — Gumbel copula)
  Asymmetry: ${tail.asymmetry > 0 ? "+" : ""}${tail.asymmetry.toFixed(3)} (positive = crashes more correlated than rallies)
  Tail ratio: ${tail.tailRatio.toFixed(1)}x (crash amplification vs rally)
  Pearson ρ: ${tail.pearsonRho.toFixed(2)} (linear correlation for reference)
  Tail regime: ${tail.regime}
  Risk: ${tail.riskLabel}
  NOTE: λL > 0.3 means diversification fails during crashes. If crash-coupled AND near ATH, reduce position.
`;
          }
        } catch { /* copula computation failed, skip */ }
      }
    } catch { /* entropy computation failed, use default block */ }

    const lookup = buildHeatmapLookup(heatmapRows);
    const stubStock = {
      symbol,
      sector: quote.sector as string,
      industry: quote.industry as string,
      sector_rank: null,
      industry_rank: null,
    } as unknown as WatchlistStock;
    const hm = matchStock(stubStock, lookup);

    const prompt = buildPrompt(quote, hist, hm, entropyBlock);

    async function callLlm(): Promise<{ res: Response; text: string }> {
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
              max_tokens: 8000,
              temperature: 0.2,
            }),
          });
          const text = await res.text();
          const isHtml = text.trimStart().startsWith("<");
          if (res.ok && !isHtml) return { res, text };
          if (isHtml && attempt < MAX_RETRIES) {
            console.warn(`OpenAI returned Cloudflare page, retry ${attempt + 1}/${MAX_RETRIES}...`);
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }
          console.warn(`OpenAI direct failed (${res.status}${isHtml ? " Cloudflare" : ""}), trying Eden AI...`);
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
            max_tokens: 8000,
            temperature: 0.2,
          }),
        });
        const text = await res.text();
        if (res.ok && !text.trimStart().startsWith("<")) return { res, text };
        console.warn(`Eden AI failed (${res.status}), falling back to OpenRouter...`);
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
            max_tokens: 8000,
            temperature: 0.2,
          }),
        });
        const text = await res.text();
        return { res, text };
      }
      throw new Error("No LLM provider available");
    }

    const { res: llmRes, text: llmText } = await callLlm();

    if (!llmRes.ok) {
      const isHtml = llmText.trimStart().startsWith("<");
      const errMsg = isHtml
        ? `Cloudflare blocked request (${llmRes.status}). Retry in a moment.`
        : llmText.slice(0, 300);
      console.error("LLM error:", llmRes.status, errMsg);
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    let llmData;
    try {
      llmData = JSON.parse(llmText);
    } catch {
      const preview = llmText.slice(0, 200);
      console.error("LLM returned non-JSON:", preview);
      return NextResponse.json(
        { error: `LLM returned non-JSON response: ${preview}` },
        { status: 502 }
      );
    }
    const report: string = llmData.choices?.[0]?.message?.content || "";

    if (!report) {
      return NextResponse.json({ error: "Empty LLM response" }, { status: 502 });
    }

    // Parse JSON block from report
    let parsed: Record<string, unknown> = {};
    const jsonMatch = report.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch { /* ok, save report anyway */ }
    }

    // Save LLM analysis fields to DB
    const sql = getDb();
    await sql`
      UPDATE watchlist_items SET
        analysis_report = ${report},
        clock_position = COALESCE(${(parsed.clock_position as string) || null}, clock_position),
        phase = COALESCE(${(parsed.phase as string) || null}, phase),
        corporate_stage = COALESCE(${(parsed.corporate_stage as string) || null}, corporate_stage),
        wall_revenue = COALESCE(${(parsed.wall_revenue as string) || null}, wall_revenue),
        wall_margins = COALESCE(${(parsed.wall_margins as string) || null}, wall_margins),
        wall_capital = COALESCE(${(parsed.wall_capital as string) || null}, wall_capital),
        wall_discount = COALESCE(${(parsed.wall_discount as string) || null}, wall_discount),
        wall_fcf = COALESCE(${(parsed.wall_fcf as string) || null}, wall_fcf),
        wall_combo = COALESCE(${(parsed.wall_combo as string) || null}, wall_combo),
        green_walls = COALESCE(${parsed.green_walls as number || null}, green_walls),
        yellow_walls = COALESCE(${parsed.yellow_walls as number || null}, yellow_walls),
        red_walls = COALESCE(${parsed.red_walls as number || null}, red_walls),
        extreme_score = COALESCE(${parsed.extreme_score as number || null}, extreme_score),
        action = COALESCE(${(parsed.action as string) || null}, action),
        buy_reason = COALESCE(${(parsed.buy_reason as string) || null}, buy_reason),
        notes = COALESCE(${(parsed.notes as string) || null}, notes),
        narrative = COALESCE(${(parsed.narrative as string) || null}, narrative),
        narrative_cycle_history = COALESCE(${(parsed.narrative_cycle_history as string) || null}, narrative_cycle_history),
        moat_type = COALESCE(${(parsed.moat_type as string) || null}, moat_type),
        moat_width = COALESCE(${(parsed.moat_width as string) || null}, moat_width),
        moat_trend = COALESCE(${(parsed.moat_trend as string) || null}, moat_trend),
        moat_sources = COALESCE(${(parsed.moat_sources as string) || null}, moat_sources)
      WHERE id = (
        SELECT id FROM watchlist_items
        WHERE symbol = ${symbol}
        ORDER BY created_at DESC LIMIT 1
      )
    `;

    // Recompute composite score from the freshly updated record (single atomic update)
    const updated = await fetchStock(symbol);
    let compositeScore = 0;
    if (updated) {
      const breakdown = computeCompositeScore(updated);
      compositeScore = breakdown.total;
      await sql`
        UPDATE watchlist_items SET composite_score = ${compositeScore}
        WHERE id = ${updated.id}
      `;
    }

    revalidateTag("stocks", "max");
    revalidatePath("/");
    revalidatePath(`/stock/${encodeURIComponent(symbol)}`);

    return NextResponse.json({ ok: true, report, parsed, compositeScore });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("analyze-report error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

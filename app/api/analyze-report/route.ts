import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { getDb, getCachedHeatmap } from "@/lib/db";
import { buildHeatmapLookup, matchStock, type StockHeatmapContext } from "@/lib/heatmap-match";
import type { WatchlistStock } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { cachedQuote, cachedSummary, cachedHistorical } from "@/lib/yf-cache";

const MODEL = "openai/gpt-5.4";
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
  hm: StockHeatmapContext
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

**Damodaran Four Walls (trend-based):**
- Revenue Growth: >10% good, 5-10% mediocre, <5% bad
- Operating Margins: >15% good, 8-15% mediocre, <8% bad
- Capital Efficiency (ROIC): >12% good, 6-12% mediocre, <6% bad
- Discount Rates (PE): trend inverted — lower PE = favorable

Color each: GREEN (good+stable/accel), YELLOW (mixed), RED (bad+stable/decel)

**Extreme Scan (score each 1-5, total /20):**
- Industry bubble, Macro & valuation, Liquidity, Sentiment

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

### Sector & Industry Assessment
Evaluate whether the sector and sub-industry are providing tailwind or headwind.
Include 3M/6M/12M returns, momentum direction, and rank. State clearly: TAILWIND / NEUTRAL / HEADWIND.

### Gravity Check (Damodaran's Four Walls)
| Wall | Status | Evidence |
Table with GREEN/YELLOW/RED + data

**Score: X Green / Y Yellow / Z Red**

### Extreme Scan (/20)
| Dimension | Score /5 | Evidence |
Table

### Position Assessment
7 buy conditions check (including sector/industry), recommended action (buy/watch/avoid), position size suggestion.
If sector/industry is a headwind, explicitly state how it modifies the position size or conviction level.

### Key Risks
Top 3 risks (include sector/industry risk if applicable)

### Investment Thesis
2-3 paragraph thesis incorporating sector/industry context

Also output a JSON block at the end (fenced with \`\`\`json) containing:
{
  "clock_position": "~X:00",
  "phase": "Phase N ...",
  "corporate_stage": "Stage N ...",
  "wall_revenue": "... (GREEN/YELLOW/RED)",
  "wall_margins": "... (GREEN/YELLOW/RED)",
  "wall_capital": "... (GREEN/YELLOW/RED)",
  "wall_discount": "... (GREEN/YELLOW/RED)",
  "green_walls": N,
  "yellow_walls": N,
  "red_walls": N,
  "extreme_score": N,
  "sector_signal": "TAILWIND / NEUTRAL / HEADWIND",
  "action": "buy X% / watch / avoid",
  "buy_reason": "summary of 7 conditions",
  "notes": "key insight",
  "narrative": "one paragraph current narrative"
}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = await req.json();
  const symbol = (body.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  }

  try {
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

    const lookup = buildHeatmapLookup(heatmapRows);
    const stubStock = {
      symbol,
      sector: quote.sector as string,
      industry: quote.industry as string,
      sector_rank: null,
      industry_rank: null,
    } as unknown as WatchlistStock;
    const hm = matchStock(stubStock, lookup);

    const prompt = buildPrompt(quote, hist, hm);

    const llmRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://watchinglist.app",
        "X-Title": "WatchingList",
        "Content-Type": "application/json",
        "User-Agent": "WatchingList/1.0",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8000,
        temperature: 0.2,
      }),
    });

    const llmText = await llmRes.text();

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

    // Update the latest record for this symbol
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
        green_walls = COALESCE(${parsed.green_walls as number || null}, green_walls),
        yellow_walls = COALESCE(${parsed.yellow_walls as number || null}, yellow_walls),
        red_walls = COALESCE(${parsed.red_walls as number || null}, red_walls),
        extreme_score = COALESCE(${parsed.extreme_score as number || null}, extreme_score),
        action = COALESCE(${(parsed.action as string) || null}, action),
        buy_reason = COALESCE(${(parsed.buy_reason as string) || null}, buy_reason),
        notes = COALESCE(${(parsed.notes as string) || null}, notes),
        narrative = COALESCE(${(parsed.narrative as string) || null}, narrative)
      WHERE id = (
        SELECT id FROM watchlist_items
        WHERE symbol = ${symbol}
        ORDER BY created_at DESC LIMIT 1
      )
    `;

    revalidateTag("stocks", "max");

    return NextResponse.json({ ok: true, report, parsed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("analyze-report error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

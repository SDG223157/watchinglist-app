#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });

const FMP_BASE = "https://financialmodelingprep.com/stable";
const MIGRATION = path.join(ROOT, "migrations", "001_financials_history.sql");

function parseArgs(argv) {
  const args = {
    market: "all",
    years: 10,
    limit: null,
    symbols: null,
    dryRun: false,
    resume: false,
    concurrency: 4,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--market") args.market = String(next || "all").toLowerCase(), i++;
    else if (arg === "--years") args.years = Number(next || 10), i++;
    else if (arg === "--limit") args.limit = Number(next || 0), i++;
    else if (arg === "--symbols") args.symbols = String(next || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean), i++;
    else if (arg === "--concurrency") args.concurrency = Number(next || 4), i++;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--resume") args.resume = true;
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fmpGet(endpoint, params) {
  const apiKey = requireEnv("FMP_API_KEY");
  const url = new URL(`${FMP_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries({ ...params, apikey: apiKey })) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`FMP ${endpoint} ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function ensureSchema(sql) {
  const ddl = await fs.readFile(MIGRATION, "utf8");
  const statements = ddl.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await sql.query(`${statement};`);
  }
}

function marketWhere(market) {
  if (market === "us") {
    return "symbol NOT LIKE '%.HK' AND symbol NOT LIKE '%.SS' AND symbol NOT LIKE '%.SZ'";
  }
  if (market === "china") {
    return "symbol LIKE '%.HK' OR symbol LIKE '%.SS' OR symbol LIKE '%.SZ'";
  }
  return "1=1";
}

async function fetchUniverse(sql, args) {
  if (args.symbols?.length) return args.symbols;
  const rows = await sql.query(`
    SELECT DISTINCT symbol
    FROM watchlist_items
    WHERE ${marketWhere(args.market)}
    ORDER BY symbol
  `);
  const symbols = rows.map((r) => String(r.symbol).toUpperCase());
  return args.limit ? symbols.slice(0, args.limit) : symbols;
}

async function fetchCompleted(sql) {
  const rows = await sql.query("SELECT DISTINCT symbol FROM financial_metrics_asof");
  return new Set(rows.map((r) => String(r.symbol).toUpperCase()));
}

function fiscalYear(row) {
  return Number(row.fiscalYear || row.calendarYear || new Date(row.date).getUTCFullYear());
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function upsertAnnual(sql, symbol, rows) {
  for (const row of rows) {
    if (!row.date) continue;
    await sql`
      INSERT INTO financials_annual (
        symbol, fiscal_year, period_end_date, revenue, net_income, ebitda,
        operating_income, gross_profit, eps, source, raw_json, fetched_at
      )
      VALUES (
        ${symbol}, ${fiscalYear(row)}, ${row.date}, ${num(row.revenue)}, ${num(row.netIncome)},
        ${num(row.ebitda)}, ${num(row.operatingIncome)}, ${num(row.grossProfit)}, ${num(row.eps)},
        'fmp', ${JSON.stringify(row)}, NOW()
      )
      ON CONFLICT (symbol, fiscal_year, period_end_date) DO UPDATE SET
        revenue = EXCLUDED.revenue,
        net_income = EXCLUDED.net_income,
        ebitda = EXCLUDED.ebitda,
        operating_income = EXCLUDED.operating_income,
        gross_profit = EXCLUDED.gross_profit,
        eps = EXCLUDED.eps,
        raw_json = EXCLUDED.raw_json,
        fetched_at = NOW()
    `;
  }
}

async function upsertQuarterly(sql, symbol, rows) {
  for (const row of rows) {
    if (!row.date || !row.period) continue;
    await sql`
      INSERT INTO financials_quarterly (
        symbol, fiscal_year, period, period_end_date, revenue, net_income, ebitda,
        operating_income, gross_profit, eps, source, raw_json, fetched_at
      )
      VALUES (
        ${symbol}, ${fiscalYear(row)}, ${String(row.period)}, ${row.date},
        ${num(row.revenue)}, ${num(row.netIncome)}, ${num(row.ebitda)},
        ${num(row.operatingIncome)}, ${num(row.grossProfit)}, ${num(row.eps)},
        'fmp', ${JSON.stringify(row)}, NOW()
      )
      ON CONFLICT (symbol, fiscal_year, period, period_end_date) DO UPDATE SET
        revenue = EXCLUDED.revenue,
        net_income = EXCLUDED.net_income,
        ebitda = EXCLUDED.ebitda,
        operating_income = EXCLUDED.operating_income,
        gross_profit = EXCLUDED.gross_profit,
        eps = EXCLUDED.eps,
        raw_json = EXCLUDED.raw_json,
        fetched_at = NOW()
    `;
  }
}

function sumRevenue(rows) {
  if (rows.length < 4) return null;
  const vals = rows.map((row) => num(row.revenue)).filter((v) => v != null);
  return vals.length >= 4 ? vals.reduce((sum, value) => sum + value, 0) : null;
}

function computeMetrics(symbol, quarterlyRows, annualRows) {
  const q = [...quarterlyRows]
    .filter((row) => row.date && num(row.revenue) != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const annual = [...annualRows]
    .filter((row) => row.date && num(row.revenue) != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const metrics = [];
  for (let i = 7; i < q.length; i++) {
    const current4 = q.slice(i - 3, i + 1);
    const prior4 = q.slice(i - 7, i - 3);
    const currentTtm = sumRevenue(current4);
    const priorTtm = sumRevenue(prior4);
    const latestQ = q[i];
    const priorYearQ = q[i - 4];

    let revenueGrowthTtm = null;
    if (currentTtm != null && priorTtm != null && priorTtm > 0) {
      revenueGrowthTtm = ((currentTtm - priorTtm) / priorTtm) * 100;
    }

    let revenueGrowthRecentQ = null;
    if (num(latestQ.revenue) != null && num(priorYearQ.revenue) != null && num(priorYearQ.revenue) > 0) {
      revenueGrowthRecentQ = ((num(latestQ.revenue) - num(priorYearQ.revenue)) / num(priorYearQ.revenue)) * 100;
    }

    const asOf = latestQ.date;
    const annualAsOf = annual.filter((row) => row.date <= asOf);
    const latestAnnual = annualAsOf.at(-1);
    const annual3y = annualAsOf.at(-4);
    const annual5y = annualAsOf.at(-6);

    let revenueCagr3y = null;
    if (latestAnnual && annual3y && num(latestAnnual.revenue) > 0 && num(annual3y.revenue) > 0) {
      revenueCagr3y = (Math.pow(num(latestAnnual.revenue) / num(annual3y.revenue), 1 / 3) - 1) * 100;
    }

    let revenueCagr5y = null;
    if (latestAnnual && annual5y && num(latestAnnual.revenue) > 0 && num(annual5y.revenue) > 0) {
      revenueCagr5y = (Math.pow(num(latestAnnual.revenue) / num(annual5y.revenue), 1 / 5) - 1) * 100;
    }

    if (revenueGrowthTtm == null || revenueGrowthRecentQ == null || revenueCagr3y == null) continue;

    metrics.push({
      symbol,
      asOfDate: asOf,
      revenueGrowthRecentQ: +revenueGrowthRecentQ.toFixed(1),
      revenueGrowthTtm: +revenueGrowthTtm.toFixed(1),
      revenueCagr3y: +revenueCagr3y.toFixed(1),
      revenueCagr5y: revenueCagr5y == null ? null : +revenueCagr5y.toFixed(1),
      sourcePeriodsUsed: {
        latestQuarter: latestQ.date,
        priorYearQuarter: priorYearQ.date,
        ttmStart: current4[0].date,
        ttmEnd: current4.at(-1).date,
        priorTtmStart: prior4[0].date,
        priorTtmEnd: prior4.at(-1).date,
        latestAnnual: latestAnnual?.date,
        annual3y: annual3y?.date,
        annual5y: annual5y?.date,
      },
    });
  }
  return metrics;
}

async function upsertMetrics(sql, metrics) {
  for (const metric of metrics) {
    await sql`
      INSERT INTO financial_metrics_asof (
        symbol, as_of_date, revenue_growth_recent_q, revenue_growth_ttm,
        revenue_cagr_3y, revenue_cagr_5y, source_periods_used, computed_at
      )
      VALUES (
        ${metric.symbol}, ${metric.asOfDate}, ${metric.revenueGrowthRecentQ},
        ${metric.revenueGrowthTtm}, ${metric.revenueCagr3y}, ${metric.revenueCagr5y},
        ${JSON.stringify(metric.sourcePeriodsUsed)}, NOW()
      )
      ON CONFLICT (symbol, as_of_date) DO UPDATE SET
        revenue_growth_recent_q = EXCLUDED.revenue_growth_recent_q,
        revenue_growth_ttm = EXCLUDED.revenue_growth_ttm,
        revenue_cagr_3y = EXCLUDED.revenue_cagr_3y,
        revenue_cagr_5y = EXCLUDED.revenue_cagr_5y,
        source_periods_used = EXCLUDED.source_periods_used,
        computed_at = NOW()
    `;
  }
}

async function processSymbol(sql, symbol, args) {
  const quarterLimit = Math.max(args.years * 4 + 8, 48);
  const annualLimit = Math.max(args.years + 6, 16);
  const [quarterly, annual] = await Promise.all([
    fmpGet("income-statement", { symbol, period: "quarter", limit: quarterLimit }),
    fmpGet("income-statement", { symbol, period: "annual", limit: annualLimit }),
  ]);

  const metrics = computeMetrics(symbol, quarterly, annual);
  if (!args.dryRun) {
    await upsertQuarterly(sql, symbol, quarterly);
    await upsertAnnual(sql, symbol, annual);
    await upsertMetrics(sql, metrics);
  }

  return { symbol, quarterly: quarterly.length, annual: annual.length, metrics: metrics.length };
}

async function main() {
  const args = parseArgs(process.argv);
  const sql = neon(requireEnv("DATABASE_URL"));
  if (!args.dryRun) await ensureSchema(sql);
  const universe = await fetchUniverse(sql, args);
  const completed = args.resume ? await fetchCompleted(sql) : new Set();
  const symbols = universe.filter((symbol) => !completed.has(symbol));

  console.log(`Financials backfill: ${symbols.length}/${universe.length} symbols market=${args.market} dryRun=${args.dryRun}`);
  const failures = [];
  let done = 0;

  for (let i = 0; i < symbols.length; i += args.concurrency) {
    const batch = symbols.slice(i, i + args.concurrency);
    const results = await Promise.allSettled(batch.map((symbol) => processSymbol(sql, symbol, args)));
    for (const result of results) {
      done += 1;
      if (result.status === "fulfilled") {
        const r = result.value;
        console.log(`[${done}/${symbols.length}] ${r.symbol}: q=${r.quarterly} a=${r.annual} metrics=${r.metrics}`);
      } else {
        failures.push(String(result.reason?.message || result.reason));
        console.log(`[${done}/${symbols.length}] ERROR: ${failures.at(-1)}`);
      }
    }
    await sleep(250);
  }

  if (failures.length) {
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.log(`- ${failure}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

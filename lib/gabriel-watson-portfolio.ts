import type { WatchlistStock } from "./db";

export interface WatsonHistory {
  momentum12m: number;
  avgVolumeTurnover: number;
  sharpe252d: number;
}

export interface WatsonCandidate {
  symbol: string;
  name: string;
  sector: string;
  market: string;
  price: number;
  marketCap: number;
  revenueGrowth12m: number;
  revenueGrowth3y: number;
  revenueGrowth3m: number;
  momentum12m: number;
  avgVolumeTurnover: number;
  sharpe252d: number;
  ranks: {
    marketCap: number;
    revenue12m: number;
    revenue3y: number;
    revenue3m: number;
    priceMomentum: number;
    volumeTurnover: number;
  };
}

export interface WatsonHolding extends WatsonCandidate {
  weight_pct: number;
  amount: number;
  shares: number;
}

export interface WatsonResult {
  asOf: string;
  methodology: string;
  universeSize: number;
  prequalifiedCount: number;
  candidateCount: number;
  holdings: WatsonHolding[];
  excluded: { symbol: string; reason: string }[];
  summary: {
    count: number;
    capital: number;
    invested: number;
    cash: number;
    cash_pct: number;
    avgSharpe: number;
    avgMomentum12m: number;
    avgRevenue12m: number;
    avgVolumeTurnover: number;
    sectors: Record<string, number>;
  };
}

export interface WatsonConfig {
  maxHoldings: number;
  targetInvestedPct: number;
  minMarketCapRank: number;
  minRevenue12mRank: number;
  minRevenue3yRank: number;
  minRevenue3mRank: number;
  maxRevenueGrowth: number;
  minMomentumRank: number;
  minVolumeTurnoverRank: number;
}

export const DEFAULT_WATSON_CONFIG: WatsonConfig = {
  maxHoldings: 20,
  targetInvestedPct: 95,
  minMarketCapRank: 0.2,
  minRevenue12mRank: 0.8,
  minRevenue3yRank: 0.6,
  minRevenue3mRank: 0.6,
  maxRevenueGrowth: 2.0,
  minMomentumRank: 0.8,
  minVolumeTurnoverRank: 0.4,
};

type RankedStock = {
  stock: WatchlistStock;
  revenueGrowth12m: number;
  revenueGrowth3y: number;
  revenueGrowth3m: number;
  ranks: {
    marketCap: number;
    revenue12m: number;
    revenue3y: number;
    revenue3m: number;
  };
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function percentileRanks<T>(items: T[], valueOf: (item: T) => number | null): Map<T, number> {
  const valid = items
    .map((item) => ({ item, value: valueOf(item) }))
    .filter((x): x is { item: T; value: number } => x.value !== null);

  valid.sort((a, b) => a.value - b.value);
  const ranks = new Map<T, number>();
  const n = valid.length;
  if (n === 0) return ranks;
  if (n === 1) {
    ranks.set(valid[0].item, 1);
    return ranks;
  }

  for (let i = 0; i < valid.length; i++) {
    ranks.set(valid[i].item, i / (n - 1));
  }
  return ranks;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeWatsonHistory(
  stock: WatchlistStock,
  rows: Array<{ close?: number | null; volume?: number | null }>
): WatsonHistory | null {
  const clean = rows
    .map((row) => ({
      close: finiteNumber(row.close),
      volume: finiteNumber(row.volume) ?? 0,
    }))
    .filter((row): row is { close: number; volume: number } => row.close !== null && row.close > 0);

  if (clean.length < 260) return null;

  const recent = clean.slice(-252);
  const last = clean[clean.length - 1].close;
  const start = clean[clean.length - 253]?.close;
  if (!start || start <= 0) return null;

  const dailyReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    dailyReturns.push(recent[i].close / recent[i - 1].close - 1);
  }

  const mean = average(dailyReturns);
  const variance = average(dailyReturns.map((r) => (r - mean) ** 2));
  const std = Math.sqrt(variance);
  const sharpe252d = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  const marketCap = finiteNumber(stock.market_cap);
  const sharesOutstanding = marketCap && marketCap > 0 ? marketCap / last : null;
  const avgVolume = average(recent.map((row) => row.volume).filter((v) => v > 0));
  const avgVolumeTurnover = sharesOutstanding && sharesOutstanding > 0 ? avgVolume / sharesOutstanding : 0;

  return {
    momentum12m: last / start - 1,
    avgVolumeTurnover,
    sharpe252d,
  };
}

function rankFundamentals(stocks: WatchlistStock[]): RankedStock[] {
  const marketCapRanks = percentileRanks(stocks, (s) => finiteNumber(s.market_cap));
  const revenue12mRanks = percentileRanks(stocks, (s) =>
    firstFinite(s.revenue_growth_ttm, s.revenue_growth_annual)
  );
  const revenue3yRanks = percentileRanks(stocks, (s) =>
    firstFinite(s.revenue_cagr_3y, s.revenue_cagr_5y)
  );
  const revenue3mRanks = percentileRanks(stocks, (s) => finiteNumber(s.revenue_growth_recent_q));

  return stocks.flatMap((stock) => {
    const revenueGrowth12m = firstFinite(stock.revenue_growth_ttm, stock.revenue_growth_annual);
    const revenueGrowth3y = firstFinite(stock.revenue_cagr_3y, stock.revenue_cagr_5y);
    const revenueGrowth3m = finiteNumber(stock.revenue_growth_recent_q);
    if (revenueGrowth12m === null || revenueGrowth3y === null || revenueGrowth3m === null) {
      return [];
    }

    return [{
      stock,
      revenueGrowth12m,
      revenueGrowth3y,
      revenueGrowth3m,
      ranks: {
        marketCap: marketCapRanks.get(stock) ?? 0,
        revenue12m: revenue12mRanks.get(stock) ?? 0,
        revenue3y: revenue3yRanks.get(stock) ?? 0,
        revenue3m: revenue3mRanks.get(stock) ?? 0,
      },
    }];
  });
}

function passesFundamentalGates(item: RankedStock, cfg: WatsonConfig): string | null {
  if ((item.stock.market_cap || 0) <= 0) return "No market cap";
  if ((item.stock.price || 0) <= 0) return "No price";
  if (
    item.revenueGrowth12m > cfg.maxRevenueGrowth ||
    item.revenueGrowth3y > cfg.maxRevenueGrowth ||
    item.revenueGrowth3m > cfg.maxRevenueGrowth
  ) {
    return "Revenue growth >200% (possible small-base distortion)";
  }
  if (item.ranks.marketCap <= cfg.minMarketCapRank) return "Market cap below screen";
  if (item.ranks.revenue12m < cfg.minRevenue12mRank) return "12M revenue growth below top quintile";
  if (item.ranks.revenue3y < cfg.minRevenue3yRank) return "3Y revenue growth below top 40%";
  if (item.ranks.revenue3m < cfg.minRevenue3mRank) return "Recent 3M revenue growth below top 40%";
  return null;
}

export function buildWatsonPortfolio(
  stocks: WatchlistStock[],
  histories: Record<string, WatsonHistory | null>,
  capital: number,
  config: Partial<WatsonConfig> = {}
): WatsonResult {
  const cfg = { ...DEFAULT_WATSON_CONFIG, ...config };
  const excluded: { symbol: string; reason: string }[] = [];
  const ranked = rankFundamentals(stocks);

  const fundamentalPass: RankedStock[] = [];
  for (const item of ranked) {
    const reason = passesFundamentalGates(item, cfg);
    if (reason) excluded.push({ symbol: item.stock.symbol, reason });
    else fundamentalPass.push(item);
  }

  const historyReady = fundamentalPass
    .map((item) => ({ item, history: histories[item.stock.symbol] ?? null }))
    .filter((x): x is { item: RankedStock; history: WatsonHistory } => {
      if (x.history) return true;
      excluded.push({ symbol: x.item.stock.symbol, reason: "Insufficient 12M price/volume history" });
      return false;
    });

  const momentumRanks = percentileRanks(historyReady, (x) => x.history.momentum12m);
  const volumeRanks = percentileRanks(historyReady, (x) => x.history.avgVolumeTurnover);

  const candidates: WatsonCandidate[] = [];
  for (const entry of historyReady) {
    const { item, history } = entry;
    const priceMomentumRank = momentumRanks.get(entry) ?? 0;
    const volumeTurnoverRank = volumeRanks.get(entry) ?? 0;

    if (priceMomentumRank < cfg.minMomentumRank) {
      excluded.push({ symbol: item.stock.symbol, reason: "12M price momentum below top quintile" });
      continue;
    }
    if (volumeTurnoverRank < cfg.minVolumeTurnoverRank) {
      excluded.push({ symbol: item.stock.symbol, reason: "Volume turnover below liquidity screen" });
      continue;
    }

    candidates.push({
      symbol: item.stock.symbol,
      name: item.stock.name,
      sector: (item.stock.sector || "Other").trim(),
      market: item.stock.market,
      price: Number(item.stock.price || 0),
      marketCap: Number(item.stock.market_cap || 0),
      revenueGrowth12m: item.revenueGrowth12m,
      revenueGrowth3y: item.revenueGrowth3y,
      revenueGrowth3m: item.revenueGrowth3m,
      momentum12m: history.momentum12m,
      avgVolumeTurnover: history.avgVolumeTurnover,
      sharpe252d: history.sharpe252d,
      ranks: {
        ...item.ranks,
        priceMomentum: priceMomentumRank,
        volumeTurnover: volumeTurnoverRank,
      },
    });
  }

  candidates.sort((a, b) =>
    b.sharpe252d - a.sharpe252d ||
    b.momentum12m - a.momentum12m ||
    b.revenueGrowth12m - a.revenueGrowth12m
  );

  const selected = candidates.slice(0, cfg.maxHoldings);
  const equalWeight = selected.length > 0 ? cfg.targetInvestedPct / selected.length : 0;
  const holdings: WatsonHolding[] = selected.map((candidate) => {
    const amount = capital * (equalWeight / 100);
    const shares = candidate.price > 0 ? Math.floor(amount / candidate.price) : 0;
    const actualAmount = shares * candidate.price;
    return {
      ...candidate,
      weight_pct: Math.round(equalWeight * 10) / 10,
      amount: Math.round(actualAmount * 100) / 100,
      shares,
    };
  });

  const invested = holdings.reduce((sum, h) => sum + h.amount, 0);
  const sectors: Record<string, number> = {};
  for (const h of holdings) sectors[h.sector] = (sectors[h.sector] || 0) + h.weight_pct;

  return {
    asOf: new Date().toISOString().slice(0, 10),
    methodology: "Gabriel Watson growth-momentum screen: revenue acceleration + price/volume confirmation, ranked by trailing Sharpe.",
    universeSize: stocks.length,
    prequalifiedCount: fundamentalPass.length,
    candidateCount: candidates.length,
    holdings,
    excluded: excluded.slice(0, 30),
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(invested * 100) / 100,
      cash: Math.round((capital - invested) * 100) / 100,
      cash_pct: Math.round(((capital - invested) / capital) * 1000) / 10,
      avgSharpe: holdings.length ? Math.round(average(holdings.map((h) => h.sharpe252d)) * 100) / 100 : 0,
      avgMomentum12m: holdings.length ? Math.round(average(holdings.map((h) => h.momentum12m)) * 1000) / 10 : 0,
      avgRevenue12m: holdings.length ? Math.round(average(holdings.map((h) => h.revenueGrowth12m)) * 10) / 10 : 0,
      avgVolumeTurnover: holdings.length ? Math.round(average(holdings.map((h) => h.avgVolumeTurnover)) * 10000) / 100 : 0,
      sectors: Object.fromEntries(Object.entries(sectors).sort((a, b) => b[1] - a[1])),
    },
  };
}

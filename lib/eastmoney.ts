/**
 * Chinese market K-line fallback fetcher — for A-share / LOF / QDII products
 * that Yahoo Finance doesn't cover (e.g. 易方达 LOFs 161125-161128, 164824).
 *
 * Primary source: Sina Finance (reliable for LOFs, no rate limiting issues)
 * URL: https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
 *
 * Filename kept as `eastmoney.ts` for backward compatibility; the internal
 * implementation uses Sina because Eastmoney's push2his endpoint
 * rate-limits aggressively.
 */

const SINA_BASE =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";

export interface EmBar {
  date: Date;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

function sinaSymbol(rawCode: string): string | null {
  const code = rawCode.replace(/\.(SZ|SS|SH)$/i, "");
  if (!/^\d{6}$/.test(code)) return null;
  // Shanghai: starts with 5, 6, 9 or 688 (STAR), 501 (LOF), 51x/513/518/520 (ETF)
  if (/^(5|6|9)/.test(code)) return `sh${code}`;
  // Shenzhen: starts with 0, 1 (LOF 159/161/164), 3 (ChiNext)
  if (/^(0|1|3)/.test(code)) return `sz${code}`;
  return null;
}

interface SinaBar {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Fetch daily K-line bars for a Chinese-listed product via Sina Finance.
 *
 * @param ticker A-share code ("161128", "161128.SZ", "513500.SS" — suffix optional)
 * @param startDate ISO date string or Date, inclusive
 * @param endDate ISO date string or Date, inclusive (default: today)
 */
export async function fetchEastmoneyKline(
  ticker: string,
  startDate: string | Date,
  endDate?: string | Date
): Promise<EmBar[]> {
  const symbol = sinaSymbol(ticker);
  if (!symbol) return [];

  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const end = endDate ? (typeof endDate === "string" ? new Date(endDate) : endDate) : new Date();

  // Sina uses `datalen` (how many bars back from latest). Estimate generously
  // based on calendar-day gap; clamp to 300 max.
  const calDays = Math.ceil((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const datalen = Math.min(300, Math.max(40, calDays + 10));

  const url = `${SINA_BASE}?symbol=${symbol}&scale=240&ma=no&datalen=${datalen}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://finance.sina.com.cn/",
      },
      next: { revalidate: 6 * 60 * 60 }, // 6h Next cache
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text || text === "null") return [];
    const data: SinaBar[] = JSON.parse(text);
    if (!Array.isArray(data) || data.length === 0) return [];

    const startTs = start.getTime();
    const endTs = end.getTime();

    const bars: EmBar[] = [];
    for (const bar of data) {
      const dt = new Date(bar.day);
      const ts = dt.getTime();
      if (ts < startTs || ts > endTs) continue;
      const close = Number(bar.close);
      if (!Number.isFinite(close)) continue;
      bars.push({
        date: dt,
        open: Number(bar.open),
        close,
        high: Number(bar.high),
        low: Number(bar.low),
        volume: Number(bar.volume),
      });
    }
    return bars;
  } catch {
    return [];
  }
}

/**
 * Convenience wrapper: returns bars in the shape cachedHistorical uses,
 * so it can be substituted in place.
 */
export async function fetchEastmoneyAsYahooShape(
  ticker: string,
  startDate: string | Date,
  endDate?: string | Date
): Promise<Array<{ date: Date; close: number; open?: number; high?: number; low?: number; volume?: number }>> {
  const bars = await fetchEastmoneyKline(ticker, startDate, endDate);
  return bars.map((b) => ({
    date: b.date,
    close: b.close,
    open: b.open,
    high: b.high,
    low: b.low,
    volume: b.volume,
  }));
}

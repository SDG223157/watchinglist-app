import { NextResponse } from "next/server";
import { TDA_PRESETS, analyzeTda, type TdaResult } from "@/lib/tda";
import { cachedHistorical } from "@/lib/yf-cache";
import { cacheGet, cacheSet } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface HistBar {
  date: Date;
  close: number;
  volume: number;
}

function dateKey(d: Date): string {
  return d instanceof Date
    ? d.toISOString().split("T")[0]
    : String(d).split("T")[0];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const presetKey = url.searchParams.get("preset") || "broad-market";
    const days = Math.min(Number(url.searchParams.get("days")) || 252, 500);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    const preset = TDA_PRESETS[presetKey];
    if (!preset) {
      return NextResponse.json(
        { error: `Unknown preset: ${presetKey}. Options: ${Object.keys(TDA_PRESETS).join(", ")}` },
        { status: 400 }
      );
    }

    const cacheKey = `tda:${presetKey}:${days}`;
    if (!forceRefresh) {
      const cached = await cacheGet<TdaResult & { source: string }>(cacheKey);
      if (cached && cached.computedAt) {
        const age = Date.now() - new Date(cached.computedAt).getTime();
        if (age < 4 * 60 * 60 * 1000) {
          return NextResponse.json({ ...cached, source: "cache" });
        }
      }
    }

    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 2);
    const p1 = period1.toISOString().split("T")[0];

    // Fetch all assets
    const dataMap = new Map<string, Map<string, number>>();
    const validAssets: string[] = [];
    const validDescs: string[] = [];

    await Promise.allSettled(
      preset.assets.map(async (sym, idx) => {
        const hist = (await cachedHistorical(sym, p1)) as HistBar[];
        if (!hist || hist.length < 60) return;

        const byDate = new Map<string, number>();
        for (const bar of hist) {
          if (bar.close != null && !Number.isNaN(bar.close)) {
            byDate.set(dateKey(bar.date), bar.close);
          }
        }
        if (byDate.size > 50) {
          dataMap.set(sym, byDate);
          validAssets.push(sym);
          validDescs.push(preset.descriptions[idx] || sym);
        }
      })
    );

    if (validAssets.length < 3) {
      return NextResponse.json(
        { error: `Only ${validAssets.length} assets returned data. Need ≥3.` },
        { status: 422 }
      );
    }

    // Align on common dates
    let commonDates: Set<string> = new Set();
    for (let si = 0; si < validAssets.length; si++) {
      const dates = new Set(dataMap.get(validAssets[si])!.keys());
      if (si === 0) commonDates = dates;
      else commonDates = new Set([...commonDates].filter((d: string) => dates.has(d)));
    }

    const sorted = [...commonDates!].sort();
    const trimmed = sorted.slice(-days);

    if (trimmed.length < 40) {
      return NextResponse.json(
        { error: `Only ${trimmed.length} overlapping dates. Need ≥40.` },
        { status: 422 }
      );
    }

    // Build return matrix
    const closesMatrix: number[][] = trimmed.map((d) =>
      validAssets.map((sym) => dataMap.get(sym)!.get(d)!)
    );

    // Compute pct returns
    const returns: number[][] = [];
    for (let i = 1; i < closesMatrix.length; i++) {
      const row = closesMatrix[i].map((v, c) => {
        const prev = closesMatrix[i - 1][c];
        return prev > 0 ? (v - prev) / prev : 0;
      });
      returns.push(row);
    }

    // Run TDA
    const result = analyzeTda(
      returns,
      validAssets,
      validDescs,
      presetKey,
      preset.label
    );

    await cacheSet(cacheKey, result, 4 * 60 * 60);

    return NextResponse.json({ ...result, source: "live" });
  } catch (e) {
    console.error("TDA API error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

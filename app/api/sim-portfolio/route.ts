import { NextResponse } from "next/server";
import { fetchAllLatest } from "@/lib/db";
import {
  ensureSimTables,
  getPortfolio,
  getSnapshots,
  createPortfolio,
  updatePrices,
  rebalance,
  takeSnapshot,
} from "@/lib/sim-portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await ensureSimTables();
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (id) {
      const stocks = await fetchAllLatest();
      const portfolio = await updatePrices(id, stocks);
      if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const snapshots = await getSnapshots(id);
      return NextResponse.json({ portfolio, snapshots });
    }

    const us = await getPortfolio("sim-us");
    const cn = await getPortfolio("sim-china");
    return NextResponse.json({ us, cn });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureSimTables();
    const body = await req.json();
    const { action } = body;
    const stocks = await fetchAllLatest();

    if (action === "init") {
      const us = await createPortfolio("sim-us", "US Entropy Portfolio", "us", "USD", 1_000_000, stocks);
      const cn = await createPortfolio("sim-china", "China Entropy Portfolio", "china", "CNY", 1_000_000, stocks);
      return NextResponse.json({ us, cn, status: "initialized" });
    }

    if (action === "rebalance") {
      const id = body.id as string;
      const portfolio = await rebalance(id, stocks);
      return NextResponse.json({ portfolio, status: "rebalanced" });
    }

    if (action === "rebalance-all") {
      const us = await rebalance("sim-us", stocks);
      const cn = await rebalance("sim-china", stocks);
      return NextResponse.json({ us, cn, status: "rebalanced" });
    }

    if (action === "snapshot") {
      await updatePrices("sim-us", stocks);
      await updatePrices("sim-china", stocks);
      await takeSnapshot("sim-us");
      await takeSnapshot("sim-china");
      return NextResponse.json({ status: "snapshot taken" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

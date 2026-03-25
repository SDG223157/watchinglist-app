"use client";

import { useState } from "react";
import type { HeatmapRow } from "@/lib/db";
import { HeatmapGrid } from "./heatmap-grid";

interface TabData {
  sectors: HeatmapRow[];
  industries: HeatmapRow[];
  reportDate: string | null;
}

interface Props {
  us: TabData;
  china: TabData;
}

export function HeatmapTabs({ us, china }: Props) {
  const [tab, setTab] = useState<"SP500" | "China">("SP500");
  const data = tab === "SP500" ? us : china;

  return (
    <div>
      <div className="flex gap-1 mb-6 rounded-lg p-1 w-fit" style={{ background: "var(--card)" }}>
        {(["SP500", "China"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer"
            style={{
              background: tab === t ? "var(--blue)" : "transparent",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {t === "SP500" ? "US (S&P 500)" : "China (HSI/CSI)"}
          </button>
        ))}
      </div>

      <HeatmapGrid
        sectors={data.sectors}
        industries={data.industries}
        universe={tab}
        reportDate={data.reportDate}
      />
    </div>
  );
}

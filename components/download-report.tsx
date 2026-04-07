"use client";

import Link from "next/link";

interface Props {
  symbol: string;
}

export function DownloadReport({ symbol }: Props) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(symbol)}/report`}
      target="_blank"
      className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors inline-block"
      style={{ background: "var(--blue)", color: "#000" }}
    >
      Download Report
    </Link>
  );
}

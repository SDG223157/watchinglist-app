import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchingList — Investment Dashboard",
  description: "Real-time watchlist dashboard with Damodaran wall analysis, narrative cycles, and signal tracking",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

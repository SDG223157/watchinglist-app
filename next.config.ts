import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  headers: async () => [
    {
      source: "/:path*(svg|jpg|jpeg|png|gif|ico|webp|woff|woff2)",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
    // _next/static already has immutable caching built-in by Next.js
  ],
};

export default nextConfig;

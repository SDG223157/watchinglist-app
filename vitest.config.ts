import { defineConfig } from "vitest/config";
import path from "node:path";

// Load DATABASE_URL (and other secrets) from .env and .env.local the same way
// Next.js does. Vitest otherwise only sees process.env, so without this the
// Neon-backed tests would fail with "DATABASE_URL is undefined".
import "dotenv/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

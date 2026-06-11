import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — minimal Node-environment setup for the `lib/` regression
 * suite. Tests live alongside the code (`*.test.ts`) and exercise the
 * pure-function modules (no React, no Recharts, no Prisma). The `@/` path
 * alias mirrors the project's `tsconfig.json` so imports like
 * `@/lib/progress` resolve the same way they do in app code.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

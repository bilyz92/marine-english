import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], setupFiles: ["tests/helpers/setup-unit.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-integration.ts"],
          maxWorkers: 4,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

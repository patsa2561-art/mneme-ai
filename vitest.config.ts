import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/.tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "packages/core/src/**",
        "packages/embeddings/src/**",
        "packages/correlator/src/**",
      ],
      exclude: ["**/*.test.ts", "**/__fixtures__/**", "**/dist/**"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@mneme-ai/core/public": resolve(ROOT, "packages/core/src/public.ts"),
      "@mneme-ai/core": resolve(ROOT, "packages/core/src/index.ts"),
      "@mneme-ai/embeddings": resolve(ROOT, "packages/embeddings/src/index.ts"),
      "@mneme-ai/mcp": resolve(ROOT, "packages/mcp/src/index.ts"),
      "@mneme-ai/correlator": resolve(ROOT, "packages/correlator/src/index.ts"),
    },
  },
});

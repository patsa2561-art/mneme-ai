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
    // The suite has many REAL-IO / REAL-PROCESS tests (spawn the CLI bin, drive a
    // live HTTP server, run git subprocesses, reap real PIDs). Under the full
    // 860-file parallel run they intermittently flake on CPU/git contention even
    // though each passes reliably in isolation. A modest retry absorbs that
    // transient contention WITHOUT weakening any assertion — a real regression
    // still fails all attempts (deterministic failures are not masked).
    retry: 2,
    pool: "forks",
    // Root cause of the real-process flake class: with `forks` defaulting to one
    // worker per core (24 here), 860 files — many of which spawn git / the CLI bin
    // / live servers — explode into hundreds of concurrent child processes and
    // saturate the box, so real-IO tests miss timing even across retries. Capping
    // the worker pool gives those tests headroom → stable, while staying parallel.
    poolOptions: { forks: { minForks: 1, maxForks: 10 } },
    reporters: ["default"],
    // v2.19.74 — load the global setup that installs per-worker
    // unhandledRejection + uncaughtException handlers.  Without these,
    // an unhandled rejection in ANY test path kills the tinypool
    // worker process + bubbles up as
    //   "Unhandled 'error' event ... Worker exited unexpectedly"
    // which previously aborted the full CI run on ubuntu-24.04-arm.
    // See tests/vitest-setup.ts for the rationale.
    setupFiles: ["tests/vitest-setup.ts"],
    server: {
      // Vite's pre-bundler tries to resolve every import including Node
      // built-ins. Newer builtins like `node:sqlite` (Node 22.5+) aren't
      // in its built-in list, so it fails with "Failed to load url sqlite".
      // The fix is to mark them as external so Node's own loader handles
      // them at runtime.
      deps: {
        external: ["node:sqlite", /^node:/],
      },
    },
  },
  optimizeDeps: {
    exclude: ["node:sqlite"],
  },
  resolve: {
    alias: [
      // Vite strips `node:` from `node:sqlite` and then can't find a
      // package called "sqlite". Map the bare name back to the builtin
      // so Node's native loader handles it.
      { find: /^sqlite$/, replacement: "node:sqlite" },
      { find: "@mneme-ai/core/public", replacement: resolve(ROOT, "packages/core/src/public.ts") },
      { find: "@mneme-ai/core", replacement: resolve(ROOT, "packages/core/src/index.ts") },
      { find: "@mneme-ai/embeddings", replacement: resolve(ROOT, "packages/embeddings/src/index.ts") },
      { find: "@mneme-ai/mcp", replacement: resolve(ROOT, "packages/mcp/src/index.ts") },
      { find: "@mneme-ai/correlator", replacement: resolve(ROOT, "packages/correlator/src/index.ts") },
    ],
  },
  ssr: {
    // Belt-and-braces alongside `test.server.deps.external` — covers SSR
    // transform path that vitest uses when test files cross the package
    // boundary.
    external: ["node:sqlite"],
  },
});

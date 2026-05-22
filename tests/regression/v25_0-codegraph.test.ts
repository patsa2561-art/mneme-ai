// v2.25.0 — LIVING SOUL CODEGRAPH CLI regression.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("v2.25.0 — codegraph CLI", () => {
  it("`mneme codegraph --help` lists 6 subverbs", () => {
    const r = runCli(["codegraph", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("build");
    expect(r.stdout).toContain("query");
    expect(r.stdout).toContain("drift");
    expect(r.stdout).toContain("root");
    expect(r.stdout).toContain("verify");
    expect(r.stdout).toContain("warn");
  });

  it("`mneme codegraph build` returns merkle root + signature + stats", () => {
    const r = runCli(["codegraph", "build"], { cwd: REPO_ROOT, timeoutMs: 60_000 });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { merkleRoot: string; signature: string; stats: { nodes: number; edges: number } } };
    expect(parsed.data.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.data.signature).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.data.stats.nodes).toBeGreaterThan(100);
    expect(parsed.data.stats.edges).toBeGreaterThan(100);
  });

  it("`mneme codegraph drift` reports zero events on a freshly-built graph", () => {
    // build first
    runCli(["codegraph", "build"], { cwd: REPO_ROOT, timeoutMs: 60_000 });
    const r = runCli(["codegraph", "drift"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { brokenEdges: number; events: unknown[] } };
    expect(parsed.data.brokenEdges).toBe(0);
    expect(parsed.data.events.length).toBe(0);
  });

  it("`mneme codegraph verify` returns ok=true on a freshly-built graph", () => {
    runCli(["codegraph", "build"], { cwd: REPO_ROOT, timeoutMs: 60_000 });
    const r = runCli(["codegraph", "verify"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { ok: boolean; edges: number } };
    expect(parsed.data.ok).toBe(true);
    expect(parsed.data.edges).toBeGreaterThan(100);
  });
});

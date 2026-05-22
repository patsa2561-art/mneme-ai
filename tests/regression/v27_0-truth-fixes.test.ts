// v2.27.0 — TRUTH RECONCILIATION CLI regression.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("v2.27.0 — lin tick alias", () => {
  it("`mneme lin tick` no longer returns 'unknown command'", () => {
    const r = runCli(["lin", "tick"], { cwd: REPO_ROOT });
    expect(r.combined).not.toMatch(/unknown command/i);
    // Either crystallized or "no active MCP session" — both OK
    expect(r.combined).toMatch(/no active|Crystallized/i);
  });
});

describe("v2.27.0 — truth_gate CLI auto-route", () => {
  it("`mneme truth_gate --help` lists 4 subverbs", () => {
    const r = runCli(["truth_gate", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("run");
    expect(r.stdout).toContain("report");
    expect(r.stdout).toContain("claims");
    expect(r.stdout).toContain("verify");
  });

  it("`mneme truth_gate claims` returns the catalog", () => {
    const r = runCli(["truth_gate", "claims"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { count: number; claims: Array<{ id: string }> } };
    expect(parsed.data.count).toBeGreaterThanOrEqual(10);
    for (const c of parsed.data.claims) {
      expect(c.id).toMatch(/^claim\./);
    }
  });
});

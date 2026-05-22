// v2.24.0 — MCP fuzz CLI + MCP server hardening regression.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("v2.24.0 — MCP fuzz CLI", () => {
  it("`mneme fuzz --help` lists the 4 subverbs", () => {
    const r = runCli(["fuzz", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("vectors");
    expect(r.stdout).toContain("run");
    expect(r.stdout).toContain("report");
    expect(r.stdout).toContain("verify");
  });

  it("`mneme fuzz vectors` returns count=108 in JSON", () => {
    const r = runCli(["fuzz", "vectors"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { count: number; vectors: Array<{ id: string; category: string; severity: string }> } };
    expect(parsed.data.count).toBe(108);
    expect(parsed.data.vectors.length).toBe(108);
    // Sample sanity: every id starts with vec-
    for (const v of parsed.data.vectors) {
      expect(v.id).toMatch(/^vec-[a-z]\d{2}$/);
    }
  });

  it("`mneme fuzz vectors handshake` returns 12 handshake vectors", () => {
    const r = runCli(["fuzz", "vectors", "handshake"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { count: number; vectors: Array<{ category: string }> } };
    expect(parsed.data.count).toBe(12);
    expect(parsed.data.vectors.every((v) => v.category === "handshake")).toBe(true);
  });

  it("`mneme fuzz report` emits JSON when no report exists", () => {
    // In a temp env without prior fuzz runs, the latest is null.
    const r = runCli(["fuzz", "report"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { card?: unknown; note?: string } };
    expect(parsed.data).toBeDefined();
  });
});

/**
 * v2.63.0 — TIME-CRYSTAL (federated agent wisdom) pinned tests.
 *
 * Memory primitive in user's "conscience+memory+diplomat+bodyguard+
 * time-machine" Mneme MCP roadmap.
 *
 * Section map:
 *   F1 — problem fingerprinting (canonical + Jaccard similarity)
 *   F2 — Wilson lower-bound ranking
 *   F3 — recency decay
 *   F4 — env-aware grounding
 *   F5 — gotcha auto-detection
 *   F6 — HMAC-chained ledger
 *   F7 — contribute + lookup end-to-end
 *   F8 — contributor stats
 *   F9 — CLI surface
 *   F10 — TG probes
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-tc-"));
}

describe("v2.63.0 F1 — problem fingerprinting (PINNED)", () => {
  it("F1.1 normalizeProblem returns stable 16-hex fingerprint", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const r = m.normalizeProblem("Cannot find module @types/node");
    expect(r.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it("F1.2 identical phrasing → identical fingerprint", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const a = m.normalizeProblem("Cannot find module @types/node");
    const b = m.normalizeProblem("Cannot find module @types/node");
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("F1.3 entity slot normalization (different packages cluster same shape)", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const a = m.normalizeProblem("Cannot find module @types/node");
    const b = m.normalizeProblem("Cannot find module @types/react");
    // Both reduce to "<PKG> cannot find module" after sort.
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("F1.4 synonym phrasings have ≥40% Jaccard similarity", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const a = m.normalizeProblem("Cannot find module '@types/node'");
    const b = m.normalizeProblem("TypeScript Error TS2307: Cannot find module @types/node");
    const sim = m.similarity(a.canonical, b.canonical);
    expect(sim).toBeGreaterThanOrEqual(0.4);
  });

  it("F1.5 empty input → 0 fingerprint", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const r = m.normalizeProblem("");
    expect(r.fingerprint).toBe("0".repeat(16));
  });

  it("F1.6 slot counts populated", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const r = m.normalizeProblem("@types/node 5.6.3 broke src/file.ts");
    expect(r.slots["<pkg>"] ?? r.slots["<PKG>"]).toBeGreaterThanOrEqual(1);
    expect(r.slots["<ver>"] ?? r.slots["<VER>"]).toBeGreaterThanOrEqual(1);
    expect(r.slots["<path>"] ?? r.slots["<PATH>"]).toBeGreaterThanOrEqual(1);
  });
});

describe("v2.63.0 F2 — Wilson lower-bound ranking (PINNED)", () => {
  it("F2.1 high-N high-success → high Wilson-LB", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = Array.from({ length: 100 }, (_, i) => ({ approach: "X", outcome: (i < 95 ? "success" : "failure") as "success" | "failure", at: new Date().toISOString() }));
    const r = m.rankApproaches(records);
    expect(r[0]?.wilsonLB).toBeGreaterThan(0.85);
  });

  it("F2.2 small-N high-success → modest Wilson-LB (not dominated)", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = [
      { approach: "X", outcome: "success" as const, at: new Date().toISOString() },
      { approach: "X", outcome: "success" as const, at: new Date().toISOString() },
    ];
    const r = m.rankApproaches(records);
    expect(r[0]?.successRate).toBe(1);
    expect(r[0]?.wilsonLB).toBeLessThan(0.5); // Wilson-LB on 2/2 ~0.34
  });

  it("F2.3 partial counts as 0.5 success", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = [
      { approach: "X", outcome: "partial" as const, at: new Date().toISOString() },
      { approach: "X", outcome: "partial" as const, at: new Date().toISOString() },
    ];
    const r = m.rankApproaches(records);
    expect(r[0]?.successRate).toBeCloseTo(0.5, 2);
  });
});

describe("v2.63.0 F3 — recency decay (PINNED)", () => {
  it("F3.1 old records weighted lower than recent ones", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const now = new Date("2026-06-01T00:00:00Z").getTime();
    const old = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year old
    const recent = new Date(now - 60 * 1000).toISOString(); // 1 min old
    const oldR = m.rankApproaches([{ approach: "old", outcome: "success", at: old }], { now });
    const newR = m.rankApproaches([{ approach: "new", outcome: "success", at: recent }], { now });
    expect(newR[0]!.rankScore).toBeGreaterThan(oldR[0]!.rankScore);
  });
});

describe("v2.63.0 F4 — env grounding (PINNED)", () => {
  it("F4.1 env match boosts rankScore", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const r = m.rankApproaches([
      { approach: "X", outcome: "success", at: new Date().toISOString(), env: { node: "22" } },
      { approach: "Y", outcome: "success", at: new Date().toISOString(), env: { node: "18" } },
    ], { env: { node: "22" } });
    const xScore = r.find((g) => g.approach === "X")?.rankScore ?? 0;
    const yScore = r.find((g) => g.approach === "Y")?.rankScore ?? 0;
    expect(xScore).toBeGreaterThan(yScore);
  });
});

describe("v2.63.0 F5 — gotcha auto-detection (PINNED)", () => {
  it("F5.1 mixed-outcome approach with env signal → gotcha", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = [
      { approach: "delete node_modules", outcome: "success" as const, at: new Date().toISOString(), env: { pm: "npm" } },
      { approach: "delete node_modules", outcome: "success" as const, at: new Date().toISOString(), env: { pm: "npm" } },
      { approach: "delete node_modules", outcome: "failure" as const, at: new Date().toISOString(), env: { pm: "pnpm" }, note: "broke because pnpm-lock present" },
      { approach: "delete node_modules", outcome: "failure" as const, at: new Date().toISOString(), env: { pm: "pnpm" } },
    ];
    const gotchas = m.detectGotchas(records);
    expect(gotchas.length).toBe(1);
    expect(gotchas[0]?.triggerConditions.some((t) => t.key === "pm" && t.value === "pnpm")).toBe(true);
  });

  it("F5.2 all-success approach → no gotcha", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = [
      { approach: "X", outcome: "success" as const, at: new Date().toISOString() },
      { approach: "X", outcome: "success" as const, at: new Date().toISOString() },
    ];
    expect(m.detectGotchas(records).length).toBe(0);
  });

  it("F5.3 free-text failure note picked up even without env signal", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const records = [
      { approach: "X", outcome: "success" as const, at: new Date().toISOString() },
      { approach: "X", outcome: "failure" as const, at: new Date().toISOString(), note: "doesn't work on macOS" },
      { approach: "X", outcome: "failure" as const, at: new Date().toISOString(), note: "fails on big monorepo" },
      { approach: "X", outcome: "failure" as const, at: new Date().toISOString(), note: "fails on big monorepo" },
    ];
    const gotchas = m.detectGotchas(records);
    expect(gotchas.length).toBeGreaterThanOrEqual(1);
    expect(gotchas[0]?.notes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("v2.63.0 F6 — HMAC-chained ledger (PINNED)", () => {
  it("F6.1 fresh ledger → chain ok with 0 rows", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      const r = m.verifyLedgerChain(dir);
      expect(r.ok).toBe(true);
      expect(r.rows).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F6.2 3 contributions chain → ok with 3 rows", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      m.contribute({ problem: "X", approach: "A", outcome: "success", agent: "a", cwd: dir });
      m.contribute({ problem: "X", approach: "A", outcome: "success", agent: "b", cwd: dir });
      m.contribute({ problem: "X", approach: "B", outcome: "failure", agent: "c", cwd: dir });
      const r = m.verifyLedgerChain(dir);
      expect(r.ok).toBe(true);
      expect(r.rows).toBe(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.63.0 F7 — contribute + lookup end-to-end (PINNED)", () => {
  it("F7.1 lookup on a problem with 4 contributions returns ranked approaches", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      for (let i = 0; i < 4; i++) m.contribute({ problem: "Cannot find module @types/node", approach: "npm i -D @types/node", outcome: "success", agent: "agent" + i, cwd: dir });
      const r = m.lookupWisdom({ problem: "Cannot find module @types/node", cwd: dir });
      expect(r.totalContributors).toBe(4);
      expect(r.distinctAgents).toBe(4);
      expect(r.approaches.length).toBeGreaterThanOrEqual(1);
      expect(r.approaches[0]?.approach).toMatch(/npm i -D @types\/node/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F7.2 lookup HMAC envelope verifies + tamper fails", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      m.contribute({ problem: "X", approach: "A", outcome: "success", agent: "a", cwd: dir });
      const r = m.lookupWisdom({ problem: "X", cwd: dir });
      expect(m.verifyLookup(r)).toBe(true);
      const tampered = { ...r, totalContributors: 999 };
      expect(m.verifyLookup(tampered)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F7.3 lookup on empty store returns 0 contributors + plain summary", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      const r = m.lookupWisdom({ problem: "Some problem", cwd: dir });
      expect(r.totalContributors).toBe(0);
      expect(r.summary).toMatch(/no prior wisdom/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F7.4 related bucket discovery via Jaccard", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      // Slightly different phrasing → different exact fingerprint, but token-overlap related.
      m.contribute({ problem: "TypeScript error TS2307: Cannot find module @types/node when building", approach: "npm i -D @types/node", outcome: "success", agent: "a", cwd: dir });
      const r = m.lookupWisdom({ problem: "Cannot find module @types/node", cwd: dir });
      // Either it lands in same exact bucket OR shows up as related.
      expect(r.totalContributors + r.related.length).toBeGreaterThanOrEqual(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.63.0 F8 — contributor stats (PINNED)", () => {
  it("F8.1 stats counts agents + problems + outcomes correctly", async () => {
    const m = await import("../../packages/core/src/time_crystal/index.js");
    const dir = tmp();
    try {
      m.contribute({ problem: "P1", approach: "A", outcome: "success", agent: "a", cwd: dir });
      m.contribute({ problem: "P1", approach: "A", outcome: "failure", agent: "b", cwd: dir });
      m.contribute({ problem: "P2", approach: "B", outcome: "partial", agent: "a", cwd: dir });
      const stats = m.contributorStats(dir);
      expect(stats.totalContributions).toBe(3);
      expect(stats.distinctAgents).toBe(2);
      expect(stats.distinctProblems).toBe(2);
      expect(stats.outcomes.success).toBe(1);
      expect(stats.outcomes.failure).toBe(1);
      expect(stats.outcomes.partial).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.63.0 F9 — CLI surface (PINNED)", () => {
  function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000, cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("F9.1 `mneme time_crystal contribute` writes a row", () => {
    const dir = tmp();
    try {
      const r = runCli(["time_crystal", "contribute", "--problem", "P", "--approach", "A", "--outcome", "success", "--agent", "test"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.problemFingerprint).toBe("string");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F9.2 `mneme time_crystal lookup` returns envelope", () => {
    const dir = tmp();
    try {
      runCli(["time_crystal", "contribute", "--problem", "P", "--approach", "A", "--outcome", "success", "--agent", "test"], dir);
      const r = runCli(["time_crystal", "lookup", "--problem", "P"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.problemFingerprint).toBe("string");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F9.3 `mneme time_crystal stats` returns envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["time_crystal", "stats"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalContributions).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F9.4 `mneme time_crystal audit` returns envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["time_crystal", "audit"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalRows).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F9.5 `mneme time_crystal lookup --banner` outputs ASCII", () => {
    const dir = tmp();
    try {
      const r = runCli(["time_crystal", "lookup", "--problem", "P", "--banner"], dir);
      expect(r.stdout).toMatch(/TIME-CRYSTAL/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.63.0 F10 — TG probes (PINNED)", () => {
  it("F10.1 probe.time_crystal.fingerprint_clusters returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.time_crystal.fingerprint_clusters");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("F10.2 probe.time_crystal.contribute_lookup_round_trip returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.time_crystal.contribute_lookup_round_trip");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });
});

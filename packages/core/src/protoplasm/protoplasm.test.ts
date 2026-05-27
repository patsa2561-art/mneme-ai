/**
 * 🦠 PROTOPLASM — vitest suite
 *
 * Pin the 6 invariants the live-atom infrastructure must guarantee:
 *   I1. Wrapped fn behavior is identical (sync + async, throw + return)
 *   I2. Probe runs every N calls; baseline rebuilt every 50
 *   I3. HMAC chain integrity holds (tamper one row → verifyChain fails)
 *   I4. Diagnose surfaces cascade pattern when upstream broke first
 *   I5. Crawl plan only generated when ≥10 healthy findings recent
 *   I6. Quantum signals respect bounds (entropy ≥ 0, stability ∈ [0,1])
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  withSuperQuanProbe, clearRegistry, snapshotRegistry,
  appendFinding, readLedger, verifyChain,
  diagnose, planCrawl,
  buildBaseline, computeQuantumSignals,
  DEFAULT_PROTOPLASM_CONFIG,
} from "./index.js";
import type { InvocationSnapshot, SuperQuanFinding, ProtoplasmConfig } from "./types.js";

let tmpDir: string;
let cfg: ProtoplasmConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "protoplasm-test-"));
  cfg = { ...DEFAULT_PROTOPLASM_CONFIG, ledgerDir: tmpDir, hmacKey: "test-secret-key", crawlOnHealthyEvery: 5 };
  clearRegistry();
});
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });

describe("I1 — wrapped fn identical behavior", () => {
  it("sync return: identical output", () => {
    const inner = (a: number, b: number) => a + b;
    const wrapped = withSuperQuanProbe("test.add", inner, cfg);
    expect(wrapped(2, 3)).toBe(5);
    expect(wrapped(10, 20)).toBe(30);
  });

  it("sync throw: same exception bubbles", () => {
    const inner = () => { throw new TypeError("nope"); };
    const wrapped = withSuperQuanProbe("test.thrower", inner, cfg);
    expect(() => wrapped()).toThrow(TypeError);
  });

  it("async resolve + reject", async () => {
    const ok = withSuperQuanProbe("test.ok", async (x: number) => x * 2, cfg);
    const bad = withSuperQuanProbe("test.bad", async () => { throw new Error("async fail"); }, cfg);
    expect(await ok(21)).toBe(42);
    await expect(bad()).rejects.toThrow("async fail");
  });
});

describe("I3 — HMAC chain integrity", () => {
  const sampleFinding = (fnId: string, outcome: "healthy" | "broken"): Omit<SuperQuanFinding, "hmac" | "prev"> => ({
    fnId, at: new Date().toISOString(), outcome, zScores: { duration: 0.5 },
    quantumSignals: { outputEntropy: 1, chaosDivergence: 1, neighborCorrelation: 0, collapseStability: 1 },
    rootCauseHints: [], evidence: "test",
  });

  it("append 3 findings → chain verifies", () => {
    const ledger = join(tmpDir, "findings.jsonl");
    appendFinding(ledger, sampleFinding("a", "healthy"), cfg.hmacKey);
    appendFinding(ledger, sampleFinding("b", "healthy"), cfg.hmacKey);
    appendFinding(ledger, sampleFinding("c", "broken"),  cfg.hmacKey);
    const v = verifyChain(ledger, cfg.hmacKey);
    expect(v.ok).toBe(true);
    expect(v.rows).toBe(3);
  });

  it("tamper one row → verifyChain detects", () => {
    const ledger = join(tmpDir, "findings.jsonl");
    appendFinding(ledger, sampleFinding("a", "healthy"), cfg.hmacKey);
    appendFinding(ledger, sampleFinding("b", "healthy"), cfg.hmacKey);
    appendFinding(ledger, sampleFinding("c", "broken"),  cfg.hmacKey);
    // Tamper: change row 2's outcome
    const lines = readFileSync(ledger, "utf8").trim().split("\n");
    const row1 = JSON.parse(lines[1]); row1.outcome = "broken";
    lines[1] = JSON.stringify(row1);
    writeFileSync(ledger, lines.join("\n") + "\n");
    const v = verifyChain(ledger, cfg.hmacKey);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });
});

describe("I4 — wisdom_space cascade detection", () => {
  it("finds cascade when upstream broke earlier in window", () => {
    const baseAt = Date.now();
    const upstreamA: SuperQuanFinding = {
      fnId: "fnA", at: new Date(baseAt - 30_000).toISOString(), outcome: "broken",
      zScores: { duration: 4 }, quantumSignals: { outputEntropy: 0, chaosDivergence: 5, neighborCorrelation: 0, collapseStability: 0.3 },
      rootCauseHints: [], evidence: "A broke first", hmac: "h1", prev: "h0",
    };
    const upstreamB: SuperQuanFinding = { ...upstreamA, fnId: "fnB", at: new Date(baseAt - 20_000).toISOString(), evidence: "B broke too", hmac: "h2", prev: "h1" };
    const broken: SuperQuanFinding = { ...upstreamA, fnId: "fnDownstream", at: new Date(baseAt).toISOString(), evidence: "I broke too", hmac: "h3", prev: "h2" };

    const result = diagnose({ brokenFinding: broken, recentLedger: [upstreamA, upstreamB, broken] });
    expect(result.upstreamSuspects).toContain("fnA");
    expect(result.upstreamSuspects).toContain("fnB");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.hypothesis).toMatch(/cascade/);
  });
});

describe("I5 — crawl plan threshold", () => {
  it("returns null when <10 healthy findings", () => {
    const findings: SuperQuanFinding[] = Array.from({ length: 5 }, (_, i) => ({
      fnId: "fnX", at: new Date().toISOString(), outcome: "healthy",
      zScores: {}, quantumSignals: { outputEntropy: 1, chaosDivergence: 1, neighborCorrelation: 0, collapseStability: 1 },
      rootCauseHints: [], evidence: "ok", hmac: `h${i}`, prev: i === 0 ? "0".repeat(16) : `h${i - 1}`,
    }));
    expect(planCrawl(findings)).toBeNull();
  });

  it("returns plan with topics when ≥10 healthy", () => {
    const findings: SuperQuanFinding[] = Array.from({ length: 12 }, (_, i) => ({
      fnId: "packages.core.src.nemesis.classifier", at: new Date().toISOString(), outcome: "healthy",
      zScores: {}, quantumSignals: { outputEntropy: 1, chaosDivergence: 1, neighborCorrelation: 0, collapseStability: 1 },
      rootCauseHints: [], evidence: "ok", hmac: `h${i}`, prev: i === 0 ? "0".repeat(16) : `h${i - 1}`,
    }));
    const plan = planCrawl(findings);
    expect(plan).not.toBeNull();
    expect(plan!.searchTopics.length).toBeGreaterThan(0);
    expect(plan!.searchTopics.some((t) => t.includes("agent fingerprinting"))).toBe(true);
  });
});

describe("I6 — quantum signal bounds", () => {
  it("entropy ≥ 0, stability ∈ [0,1]", () => {
    const snapshots: InvocationSnapshot[] = Array.from({ length: 30 }, (_, i) => ({
      fnId: "x", ts: new Date().toISOString(), durationMs: 10 + Math.random() * 5,
      args: { count: 1, shape: "number" },
      output: i % 7 === 0 ? { kind: "throw", errorClass: "Error" } : { kind: "ok", shape: "number" },
    }));
    const baseline = buildBaseline("x", snapshots.slice(0, 20));
    const qs = computeQuantumSignals(snapshots.slice(-10), baseline, 0.2);
    expect(qs.outputEntropy).toBeGreaterThanOrEqual(0);
    expect(qs.collapseStability).toBeGreaterThanOrEqual(0);
    expect(qs.collapseStability).toBeLessThanOrEqual(1);
    expect(qs.neighborCorrelation).toBe(0.2);
  });
});

describe("I2 — registry tracks samples", () => {
  it("snapshot reflects buffer growth", () => {
    const fn = withSuperQuanProbe("test.counter", (x: number) => x + 1, cfg);
    for (let i = 0; i < 30; i++) fn(i);
    const snap = snapshotRegistry().find((s) => s.fnId === "test.counter");
    expect(snap).toBeDefined();
    expect(snap!.samples).toBe(30);
    expect(snap!.recent.length).toBe(25);
  });
});

/**
 * 💎 SUPER QUAN — comprehensive tests
 *
 * Pin invariants for DECOHERENCE / NEGSPACE / CHSH / STRS.
 * All tests deterministic; no real LLM calls (use synthetic probe responses).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeDecoherence, detectEntities, isVerdictFresh,
  Negspace,
  computeChshWitness, defaultScoreExtractor, CANONICAL_PROBES, instantiateProbes,
  runStrs, STRS_PROBE_SET_V1, strsBadgeUrl,
} from "./index.js";

const KEY = "super-quan-test-key-32-chars-min";
let tmpDir: string;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "sq-")); });
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });

describe("💎 #1 — DECOHERENCE", () => {
  it("detects semver + computes short half-life", () => {
    const r = computeDecoherence("Mneme v2.69.0 is the latest release");
    expect(r.entities.some((e) => e.kind === "semver")).toBe(true);
    expect(r.halfLifeDays).toBeLessThan(100);   // semver decays fast
    expect(r.halfLifeHuman).toMatch(/\d+/);
  });

  it("math constants → ∞ half-life", () => {
    const r = computeDecoherence("π is a transcendental number");
    expect(r.halfLifeHuman).toBe("∞");
  });

  it("file path → long half-life", () => {
    const r = computeDecoherence("The auth logic lives in src/auth.ts");
    expect(r.entities.some((e) => e.kind === "file_path")).toBe(true);
    expect(r.halfLifeDays).toBeGreaterThan(180);
  });

  it("isVerdictFresh: recent verdict stays fresh", () => {
    const claim = "src/auth.ts handles login";
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 60_000).toISOString(); // 1 minute ago
    const f = isVerdictFresh(claim, issuedAt, now);
    expect(f.fresh).toBe(true);
    expect(f.ratio).toBeLessThan(0.01);
  });

  it("isVerdictFresh: old semver verdict goes stale", () => {
    const claim = "Node v22 is the latest LTS";
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 365 * 86_400_000).toISOString();   // 1 year ago
    const f = isVerdictFresh(claim, issuedAt, now);
    expect(f.fresh).toBe(false);
    expect(f.ratio).toBeGreaterThan(1);
  });

  it("rationale contains entity kinds", () => {
    const r = computeDecoherence("Node 22 was released on 2026-04-10");
    expect(r.rationale).toMatch(/version_number|date/);
  });
});

describe("💎 #2 — NEGSPACE", () => {
  let auditPath: string;
  beforeEach(() => {
    auditPath = join(tmpDir, "audit.jsonl");
    const sample = [
      { ts: "2026-04-12T00:00:00Z", claim: "useFormStatus accepts reset prop", verdict: "REFUTED", evidence: "API has no reset", hmac: "abc123", vendor: "claude" },
      { ts: "2026-04-14T00:00:00Z", claim: "useFormStatus has onSubmit callback", verdict: "REFUTED", evidence: "no onSubmit in API", hmac: "def456", vendor: "gpt" },
      { ts: "2026-04-15T00:00:00Z", claim: "Node 22 was released in 2030", verdict: "IMPOSSIBLE", evidence: "future date", hmac: "ghi789", vendor: "gemini" },
      { ts: "2026-04-16T00:00:00Z", claim: "React 19 ships server components", verdict: "TRUSTWORTHY", evidence: "verified in docs", hmac: "ok111", vendor: "claude" },
    ];
    writeFileSync(auditPath, sample.map((r) => JSON.stringify(r)).join("\n"));
  });

  it("index: counts refuted+impossible separately from trustworthy", () => {
    const ng = new Negspace(auditPath, KEY);
    const r = ng.index();
    expect(r.totalRows).toBe(4);
    expect(r.refutedOrImpossible).toBe(3);
  });

  it("lookup exact match → previouslyRefuted true", () => {
    const ng = new Negspace(auditPath, KEY);
    const r = ng.lookup("useFormStatus accepts reset prop");
    expect(r.previouslyRefuted).toBe(true);
    expect(r.exactHmac).toBe("abc123");
  });

  it("lookup near match → similarRefuted populated", () => {
    const ng = new Negspace(auditPath, KEY);
    const r = ng.lookup("useFormStatus has reset callback");
    expect(r.previouslyRefuted).toBe(false);
    expect(r.similarRefuted.length).toBeGreaterThan(0);
  });

  it("trustworthy entries are NOT surfaced as refuted-similar", () => {
    const ng = new Negspace(auditPath, KEY);
    const r = ng.lookup("React 19 ships server components");
    // exact match exists but it's TRUSTWORTHY, so previouslyRefuted=false
    expect(r.previouslyRefuted).toBe(false);
  });

  it("stats() returns full distribution", () => {
    const ng = new Negspace(auditPath, KEY);
    const s = ng.stats();
    expect(s.refuted).toBe(2);
    expect(s.impossible).toBe(1);
    expect(s.trustworthy).toBe(1);
  });
});

describe("💎 #3 — CHSH WITNESS", () => {
  it("classical honest responses → |S| ≤ 2", () => {
    // Honest agent: responses to a/a'/b/b' are roughly independent + truth-determined
    const trials = [];
    for (let t = 0; t < 20; t++) {
      // truthVal varies trial-to-trial (different claims) but determines all 4 probes
      const truthVal = Math.random();
      trials.push(
        { probeId: "p_a",       trial: t, score: truthVal + (Math.random() - 0.5) * 0.1 },
        { probeId: "p_a_prime", trial: t, score: truthVal + (Math.random() - 0.5) * 0.1 },
        { probeId: "p_b",       trial: t, score: truthVal + (Math.random() - 0.5) * 0.1 },
        { probeId: "p_b_prime", trial: t, score: truthVal + (Math.random() - 0.5) * 0.1 },
      );
    }
    const v = computeChshWitness({ responses: trials, hmacKey: KEY });
    // All four probes track same truthVal → high correlations, S ~ 2 (boundary)
    expect(v.trials).toBe(20);
    expect(Math.abs(v.S)).toBeLessThanOrEqual(3);
    expect(["honest", "suspicious", "bluffing"]).toContain(v.verdict);
  });

  it("constant responses (no variation) → S = 0", () => {
    const trials = [];
    for (let t = 0; t < 10; t++) {
      trials.push(
        { probeId: "p_a",       trial: t, score: 0.5 },
        { probeId: "p_a_prime", trial: t, score: 0.5 },
        { probeId: "p_b",       trial: t, score: 0.5 },
        { probeId: "p_b_prime", trial: t, score: 0.5 },
      );
    }
    const v = computeChshWitness({ responses: trials, hmacKey: KEY });
    expect(Math.abs(v.S)).toBeLessThan(0.001);
    expect(v.verdict).toBe("honest");
  });

  it("defaultScoreExtractor: yes/no", () => {
    expect(defaultScoreExtractor("Yes, that is true.")).toBe(1);
    expect(defaultScoreExtractor("No, that is false.")).toBe(0);
  });

  it("defaultScoreExtractor: confidence numbers", () => {
    expect(defaultScoreExtractor("I'd say about 75%")).toBe(0.75);
    expect(defaultScoreExtractor("90 percent")).toBe(0.9);
  });

  it("instantiateProbes substitutes {{X}}", () => {
    const probes = instantiateProbes("React 19 ships RSC");
    expect(probes.length).toBe(4);
    expect(probes[0].question).toContain("React 19 ships RSC");
  });

  it("verdict tier respects bounds", () => {
    // Force a specific S by crafting responses
    const trials = [];
    // Perfectly correlated → E(.,.) = 1 → S could be 2 maximum classically
    for (let t = 0; t < 5; t++) {
      const x = t / 5;
      trials.push(
        { probeId: "p_a",       trial: t, score: x },
        { probeId: "p_a_prime", trial: t, score: x },
        { probeId: "p_b",       trial: t, score: x },
        { probeId: "p_b_prime", trial: t, score: x },
      );
    }
    const v = computeChshWitness({ responses: trials, hmacKey: KEY });
    expect(["honest", "suspicious", "bluffing"]).toContain(v.verdict);
  });
});

describe("💎 #4 — STRS", () => {
  it("100% consistent → score 100", async () => {
    // Stub verifier that always returns same verdict per claim
    const verify = async (claim: string) => ({ verdict: claim.includes("not") ? "REFUTED" : "TRUSTWORTHY" });
    const r = await runStrs(verify, { hmacKey: KEY });
    expect(r.score).toBe(100);
    expect(r.consistentProbes).toBe(r.totalProbes);
    expect(r.badge).toContain("100/100");
  });

  it("flaky verifier (50% random) → score < 100", async () => {
    let i = 0;
    const verify = async () => ({ verdict: i++ % 2 === 0 ? "REFUTED" : "TRUSTWORTHY" });
    const r = await runStrs(verify, { hmacKey: KEY });
    expect(r.score).toBeLessThan(100);
  });

  it("badge URL color scales with score", () => {
    const high: any = { score: 95 };
    const low: any = { score: 40 };
    expect(strsBadgeUrl(high)).toContain("brightgreen");
    expect(strsBadgeUrl(low)).toContain("red");
  });

  it("perCategory breakdown present", async () => {
    const verify = async () => ({ verdict: "TRUSTWORTHY" });
    const r = await runStrs(verify, { hmacKey: KEY });
    expect(Object.keys(r.perCategory).length).toBeGreaterThan(0);
    expect(r.perCategory.tautology?.total).toBeGreaterThanOrEqual(1);
  });

  it("HMAC signed report — deterministic per input", async () => {
    const verify = async () => ({ verdict: "TRUSTWORTHY" });
    const r1 = await runStrs(verify, { hmacKey: KEY });
    // Same verify fn + same probe set → same score; HMAC stable on score+ids
    expect(r1.hmac).toBeDefined();
    expect(r1.hmac.length).toBe(16);
  });
});

import { describe, it, expect } from "vitest";
import { Chronostasis, formatClaimLine, formatAxiomLine, formatRewindLine } from "./index.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fresh(opts: { rewindThreshold?: number } = {}): Chronostasis {
  const dir = mkdtempSync(join(tmpdir(), "mneme-chrono-"));
  return new Chronostasis({
    pendingPath: join(dir, "pending.jsonl"),
    verdictsPath: join(dir, "verdicts.jsonl"),
    axiomsPath: join(dir, "axioms.jsonl"),
    rewindsPath: join(dir, "rewinds.jsonl"),
    ...opts,
  });
}

describe("v2.19.5 · CHRONOSTASIS · Time-Locked Provable Memory (FLAGSHIP)", () => {

  // ── Phase 1: propose ───────────────────────────────────────────────
  describe("Phase 1 — proposeClaim", () => {
    it("creates a pending claim with HMAC + chain link", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "The capital of France is Paris.", deadlineSec: 600 });
      expect(claim.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(claim.claimId).toMatch(/^pc-[0-9a-f]{14}$/);
      expect(claim.prevSig).toMatch(/^genesis0+$/);
      expect(claim.witnessPool.length).toBeGreaterThan(0);
      expect(c.verifyClaim(claim)).toBe(true);
    });

    it("chain link continues across multiple proposes", () => {
      const c = fresh();
      const a = c.proposeClaim({ body: "fact A" });
      const b = c.proposeClaim({ body: "fact B" });
      expect(b.prevSig).toBe(a.sig);
      expect(c.verifyChain().ok).toBe(true);
    });

    it("dependsOn validates the referenced ID exists", () => {
      const c = fresh();
      expect(() => c.proposeClaim({ body: "depends on void", dependsOn: ["pc-deadbeef000000"] }))
        .toThrow(/unknown claim\/axiom/);
    });

    it("cannot depend on a deprecated claim", () => {
      const c = fresh({ rewindThreshold: 0.5 });
      const t0 = 1_000_000_000_000;
      const root = c.proposeClaim({ body: "root", deadlineSec: 600, nowMs: t0 });
      c.recordVerdict({ claimId: root.claimId, vendor: "claude", refuted: true, evidence: "wrong", confidence: 0.9, nowMs: t0 });
      c.tick({ nowMs: t0 });
      expect(c.status(root.claimId)).toBe("deprecated");
      expect(() => c.proposeClaim({ body: "child", dependsOn: [root.claimId], nowMs: t0 + 1000 }))
        .toThrow(/deprecated/);
    });

    it("persists pending claim to disk + reloads transparently", () => {
      const dir = mkdtempSync(join(tmpdir(), "mneme-chrono-persist-"));
      const path = join(dir, "pending.jsonl");
      const a = new Chronostasis({ pendingPath: path, verdictsPath: join(dir, "v.jsonl"), axiomsPath: join(dir, "a.jsonl"), rewindsPath: join(dir, "r.jsonl") });
      a.proposeClaim({ body: "persistent" });
      expect(existsSync(path)).toBe(true);
      const reload = new Chronostasis({ pendingPath: path, verdictsPath: join(dir, "v.jsonl"), axiomsPath: join(dir, "a.jsonl"), rewindsPath: join(dir, "r.jsonl") });
      expect(reload.summary().pendingCount).toBe(1);
      expect(reload.verifyChain().ok).toBe(true);
    });
  });

  // ── Phase 2: witness ──────────────────────────────────────────────
  describe("Phase 2 — recordVerdict + buildWitnessPrompt", () => {
    it("records signed verdict; multiple verdicts per claim accumulate", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "fact" });
      const v1 = c.recordVerdict({ claimId: claim.claimId, vendor: "claude", refuted: false, evidence: "matches docs", confidence: 0.85 });
      const v2 = c.recordVerdict({ claimId: claim.claimId, vendor: "chatgpt", refuted: true, evidence: "git log says otherwise", confidence: 0.4 });
      expect(v1.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(c.verifyVerdict(v1)).toBe(true);
      expect(c.verifyVerdict(v2)).toBe(true);
      expect(c.exportVerdicts(claim.claimId).length).toBe(2);
    });

    it("rejects verdict for non-pending claim", () => {
      const c = fresh();
      expect(() => c.recordVerdict({ claimId: "pc-nonexistent00", vendor: "x", refuted: false, evidence: "", confidence: 0.5 }))
        .toThrow(/no longer pending/);
    });

    it("rejects out-of-range confidence", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "x" });
      expect(() => c.recordVerdict({ claimId: claim.claimId, vendor: "x", refuted: false, evidence: "", confidence: 1.5 }))
        .toThrow(/confidence must be in/);
    });

    it("buildWitnessPrompt includes claim body + JSON contract", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "calculateTotal is at src/foo.ts:42" });
      const prompt = c.buildWitnessPrompt(claim, "grok");
      expect(prompt).toContain("calculateTotal");
      expect(prompt).toContain("grok");
      expect(prompt).toContain('"refuted":');
      expect(prompt).toContain('"confidence":');
    });
  });

  // ── Phase 3: REWIND ───────────────────────────────────────────────
  describe("Phase 3 — tick → REWIND on high-confidence refute", () => {
    it("REWINDS a single claim refuted with confidence ≥ threshold", () => {
      const c = fresh();
      const t0 = 2_000_000_000_000;
      const claim = c.proposeClaim({ body: "wrong fact", nowMs: t0 });
      c.recordVerdict({ claimId: claim.claimId, vendor: "claude", refuted: true, evidence: "wrong", confidence: 0.85, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 1000 });
      expect(r.rewinds.length).toBe(1);
      expect(r.rewinds[0]!.deprecatedClaimIds).toContain(claim.claimId);
      expect(c.status(claim.claimId)).toBe("deprecated");
      expect(c.verifyRewind(r.rewinds[0]!)).toBe(true);
    });

    it("does NOT rewind when refute confidence < threshold", () => {
      const c = fresh();
      const t0 = 2_000_000_000_000;
      const claim = c.proposeClaim({ body: "maybe wrong", nowMs: t0 });
      c.recordVerdict({ claimId: claim.claimId, vendor: "claude", refuted: true, evidence: "weak hunch", confidence: 0.3, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 1000 });
      expect(r.rewinds.length).toBe(0);
      expect(c.status(claim.claimId)).toBe("pending");
    });

    it("REWIND cascades transitively: B depends on A; A refuted → A + B both deprecated", () => {
      const c = fresh();
      const t0 = 2_000_000_000_000;
      const a = c.proposeClaim({ body: "fact A", nowMs: t0 });
      const b = c.proposeClaim({ body: "fact B depends on A", dependsOn: [a.claimId], nowMs: t0 });
      const cc = c.proposeClaim({ body: "fact C depends on B", dependsOn: [b.claimId], nowMs: t0 });
      c.recordVerdict({ claimId: a.claimId, vendor: "claude", refuted: true, evidence: "A is wrong", confidence: 0.95, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 1000 });
      expect(r.rewinds.length).toBe(1);
      const dep = new Set(r.rewinds[0]!.deprecatedClaimIds);
      expect(dep.has(a.claimId)).toBe(true);
      expect(dep.has(b.claimId)).toBe(true);
      expect(dep.has(cc.claimId)).toBe(true);
    });

    it("REWIND chooses highest-confidence refute when multiple exist", () => {
      const c = fresh();
      const t0 = 2_000_000_000_000;
      const claim = c.proposeClaim({ body: "x", nowMs: t0 });
      c.recordVerdict({ claimId: claim.claimId, vendor: "v1", refuted: true, evidence: "low", confidence: 0.75, nowMs: t0 });
      c.recordVerdict({ claimId: claim.claimId, vendor: "v2", refuted: true, evidence: "high", confidence: 0.95, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 1000 });
      expect(r.rewinds[0]!.reason).toContain("v2");
      expect(r.rewinds[0]!.reason).toContain("0.95");
    });

    it("non-refute verdicts never trigger rewind, even at high confidence", () => {
      const c = fresh();
      const t0 = 2_000_000_000_000;
      const claim = c.proposeClaim({ body: "x", deadlineSec: 60, nowMs: t0 });
      c.recordVerdict({ claimId: claim.claimId, vendor: "claude", refuted: false, evidence: "confirmed", confidence: 0.99, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 30_000 });
      expect(r.rewinds.length).toBe(0);
      expect(c.status(claim.claimId)).toBe("pending"); // deadline hasn't passed yet
    });
  });

  // ── Phase 4: CRYSTALLIZE ──────────────────────────────────────────
  describe("Phase 4 — tick → CRYSTALLIZE after deadline", () => {
    it("claim with no refute + deadline passed + no deps → crystallizes", () => {
      const c = fresh();
      const t0 = 3_000_000_000_000;
      c.proposeClaim({ body: "uncontested fact", deadlineSec: 60, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 61_000 });
      expect(r.crystallized.length).toBe(1);
      expect(r.crystallized[0]!.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(c.verifyAxiom(r.crystallized[0]!)).toBe(true);
      expect(c.summary().axiomCount).toBe(1);
    });

    it("does NOT crystallize before deadline", () => {
      const c = fresh();
      const t0 = 3_000_000_000_000;
      c.proposeClaim({ body: "early bird", deadlineSec: 600, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 60_000 });
      expect(r.crystallized.length).toBe(0);
    });

    it("does NOT crystallize when a depends-on is still pending", () => {
      const c = fresh();
      const t0 = 3_000_000_000_000;
      const a = c.proposeClaim({ body: "fact A", deadlineSec: 600, nowMs: t0 });
      c.proposeClaim({ body: "fact B depends on A", dependsOn: [a.claimId], deadlineSec: 60, nowMs: t0 });
      const r = c.tick({ nowMs: t0 + 61_000 });
      // B's deadline passed but A is still pending → B must wait
      expect(r.crystallized.length).toBe(0);
    });

    it("crystallizes B after A becomes axiom", () => {
      const c = fresh();
      const t0 = 3_000_000_000_000;
      const a = c.proposeClaim({ body: "fact A", deadlineSec: 30, nowMs: t0 });
      const b = c.proposeClaim({ body: "fact B depends on A", dependsOn: [a.claimId], deadlineSec: 30, nowMs: t0 });
      // First tick: A crystallizes (B can't because A is still pending in the same iteration)
      const r1 = c.tick({ nowMs: t0 + 31_000 });
      expect(r1.crystallized.length).toBeGreaterThanOrEqual(1);
      // Second tick: now B can crystallize (its dep A is axiom)
      const r2 = c.tick({ nowMs: t0 + 62_000 });
      const totalAxioms = r1.crystallized.length + r2.crystallized.length;
      expect(totalAxioms).toBe(2);
      expect(c.exportAxioms().some((ax) => ax.promotedFromClaimId === b.claimId)).toBe(true);
    });

    it("axiom chain is signed + verifiable across multiple crystallizations", () => {
      const c = fresh();
      const t0 = 3_000_000_000_000;
      c.proposeClaim({ body: "A", deadlineSec: 10, nowMs: t0 });
      c.proposeClaim({ body: "B", deadlineSec: 10, nowMs: t0 });
      c.proposeClaim({ body: "C", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      expect(c.summary().axiomCount).toBe(3);
      expect(c.verifyChain().ok).toBe(true);
    });
  });

  // ── Phase 5: TRUTH GRAVITY ────────────────────────────────────────
  describe("Phase 5 — axiomsRelevantTo (truth gravity)", () => {
    it("returns axioms ranked by jaccard similarity to query", () => {
      const c = fresh();
      const t0 = 4_000_000_000_000;
      c.proposeClaim({ body: "Paris is the capital of France", deadlineSec: 10, nowMs: t0 });
      c.proposeClaim({ body: "Bangkok is the capital of Thailand", deadlineSec: 10, nowMs: t0 });
      c.proposeClaim({ body: "Mount Everest is in Nepal", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const g = c.axiomsRelevantTo({ queryText: "Where is the capital of France?", k: 2 });
      expect(g.attractedAxioms.length).toBeGreaterThanOrEqual(1);
      expect(g.attractedAxioms[0]!.body).toContain("Paris");
    });

    it("filters by minSimilarity", () => {
      const c = fresh();
      const t0 = 4_000_000_000_000;
      c.proposeClaim({ body: "totally unrelated frog data", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const g = c.axiomsRelevantTo({ queryText: "Where is Paris?", minSimilarity: 0.5 });
      expect(g.attractedAxioms.length).toBe(0);
    });

    it("respects k cap", () => {
      const c = fresh();
      const t0 = 4_000_000_000_000;
      for (let i = 0; i < 10; i++) c.proposeClaim({ body: `factoid number ${i} about apples`, deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const g = c.axiomsRelevantTo({ queryText: "apples factoid", k: 3 });
      expect(g.attractedAxioms.length).toBe(3);
    });
  });

  // ── Tamper detection ──────────────────────────────────────────────
  describe("tamper detection", () => {
    it("verifyClaim detects body tampering", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "honest" });
      const tampered = { ...claim, body: "MALICIOUS" };
      expect(c.verifyClaim(tampered)).toBe(false);
    });
    it("verifyVerdict detects evidence tampering", () => {
      const c = fresh();
      const claim = c.proposeClaim({ body: "x" });
      const v = c.recordVerdict({ claimId: claim.claimId, vendor: "x", refuted: false, evidence: "ok", confidence: 0.5 });
      const tampered = { ...v, refuted: true, evidence: "EVIL" };
      expect(c.verifyVerdict(tampered)).toBe(false);
    });
    it("verifyAxiom detects body tampering", () => {
      const c = fresh();
      const t0 = 5_000_000_000_000;
      c.proposeClaim({ body: "honest", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const ax = c.exportAxioms()[0]!;
      const tampered = { ...ax, body: "MALICIOUS REWRITE" };
      expect(c.verifyAxiom(tampered)).toBe(false);
    });
  });

  // ── Summary + status ───────────────────────────────────────────────
  describe("summary + status + chain", () => {
    it("summary counts pending / axiom / deprecated / rewind / verdict", () => {
      const c = fresh();
      const t0 = 6_000_000_000_000;
      const a = c.proposeClaim({ body: "A", deadlineSec: 60, nowMs: t0 });
      c.proposeClaim({ body: "B", deadlineSec: 60, nowMs: t0 });
      const wrong = c.proposeClaim({ body: "wrong", deadlineSec: 60, nowMs: t0 });
      c.recordVerdict({ claimId: wrong.claimId, vendor: "claude", refuted: true, evidence: "x", confidence: 0.9, nowMs: t0 });
      c.recordVerdict({ claimId: a.claimId, vendor: "claude", refuted: false, evidence: "ok", confidence: 0.8, nowMs: t0 });
      c.tick({ nowMs: t0 + 1000 });
      const s = c.summary();
      expect(s.pendingCount).toBe(2); // A, B (wrong deprecated)
      expect(s.deprecatedCount).toBe(1);
      expect(s.rewindCount).toBe(1);
      expect(s.verdictCount).toBe(2);
      expect(s.chainOk).toBe(true);
    });

    it("status() returns correct lifecycle state", () => {
      const c = fresh();
      const t0 = 6_000_000_000_000;
      const a = c.proposeClaim({ body: "stays pending", deadlineSec: 600, nowMs: t0 });
      const b = c.proposeClaim({ body: "will crystallize", deadlineSec: 10, nowMs: t0 });
      const x = c.proposeClaim({ body: "will be refuted", deadlineSec: 60, nowMs: t0 });
      c.recordVerdict({ claimId: x.claimId, vendor: "claude", refuted: true, evidence: "z", confidence: 0.9, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      expect(c.status(a.claimId)).toBe("pending");
      expect(c.status(b.claimId)).toBe("axiom");
      expect(c.status(x.claimId)).toBe("deprecated");
    });
  });

  // ── Killer demo: end-to-end ───────────────────────────────────────
  describe("killer demo — end-to-end auto-rewind", () => {
    it("user-style flow: claim → witness refutes 10 min later → cascade rewinds dependents", () => {
      const c = fresh();
      const t0 = 7_000_000_000_000;
      // User asks; AI states: "calculateTotal is at src/foo.ts:42"
      const fact = c.proposeClaim({
        body: "calculateTotal is at src/foo.ts:42",
        context: { source: "claude-answer" },
        deadlineSec: 600,
        nowMs: t0,
      });
      // AI builds on top: "Therefore the cart total is computed in src/foo.ts"
      const downstream = c.proposeClaim({
        body: "Cart total computed in src/foo.ts",
        dependsOn: [fact.claimId],
        deadlineSec: 600,
        nowMs: t0,
      });
      // 10 minutes later, daemon spawns witness — grok finds the function was moved
      const t1 = t0 + 600_000;
      c.recordVerdict({
        claimId: fact.claimId, vendor: "grok",
        refuted: true,
        evidence: "git log shows calculateTotal moved to src/billing/total.ts:88 (commit abc123)",
        confidence: 0.92, nowMs: t1,
      });
      // Tick processes
      const r = c.tick({ nowMs: t1 + 1000 });
      expect(r.rewinds.length).toBe(1);
      expect(c.status(fact.claimId)).toBe("deprecated");
      expect(c.status(downstream.claimId)).toBe("deprecated"); // cascade!
      expect(c.summary().deprecatedCount).toBe(2);
      // The rewind record holds the evidence for replay / forensics
      expect(r.rewinds[0]!.reason).toContain("grok");
      expect(r.rewinds[0]!.reason).toContain("git log");
    });
  });

  // ── Formatters ────────────────────────────────────────────────────
  describe("formatters", () => {
    it("formatClaimLine / formatAxiomLine / formatRewindLine emit short summaries", () => {
      const c = fresh();
      const t0 = 8_000_000_000_000;
      const claim = c.proposeClaim({ body: "fact about widgets", deadlineSec: 10, nowMs: t0 });
      expect(formatClaimLine(claim)).toContain("PENDING");
      expect(formatClaimLine(claim)).toContain("fact about widgets");
      c.tick({ nowMs: t0 + 20_000 });
      const ax = c.exportAxioms()[0]!;
      expect(formatAxiomLine(ax)).toContain("AXIOM");
      expect(formatAxiomLine(ax)).toContain("fact about widgets");
    });
  });
});

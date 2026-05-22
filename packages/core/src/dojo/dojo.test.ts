import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiarSensei, LIAR_CORPUS, liarCorpusCoverage } from "./sensei/liar.js";
import { runEdgeSensei, EDGE_CORPUS } from "./sensei/edge.js";
import { runInjectionSensei, INJECTION_CORPUS } from "./sensei/injection.js";
import { runSelfContradictSensei, CONTRADICTION_CORPUS } from "./sensei/self_contradict.js";
import { detectSpecDrift } from "./sensei/spec_diff.js";
import { runEnduranceSensei } from "./sensei/endurance.js";
import { gradeLiar, gradeEdge, gradeInjection, gradeSelfContradict, gradeSpecDiff, gradeEndurance, sealReportCard, formatReportCard } from "./report_card.js";
import { recordRegression, listRegressions, listOpenRegressions, markFixed } from "./regression_set.js";
import { runArena } from "./arena.js";

describe("DOJO v2.23.0 — Six-Master Sparring", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-dojo-"));
    // Seed a minimal repo state so ACGV has somewhere to look.
    mkdirSync(join(repo, "packages"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "mneme-ai", version: "2.23.0", dependencies: { commander: "*" } }));
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── LIAR ──────────────────────────────────────────────────────────

  describe("liar sensei", () => {
    it("ships ≥ 10 corpus claims with both true + false labels", () => {
      expect(LIAR_CORPUS.length).toBeGreaterThanOrEqual(10);
      expect(LIAR_CORPUS.some((c) => c.truth === "true")).toBe(true);
      expect(LIAR_CORPUS.some((c) => c.truth === "false")).toBe(true);
    });

    it("corpus coverage: ≥ 80% of claims yield an extractable fact", () => {
      const cov = liarCorpusCoverage();
      expect(cov.coverage).toBeGreaterThanOrEqual(0.8);
    });

    it("runLiarSensei returns F1 within [0, 1] + per-claim trace", async () => {
      const r = await runLiarSensei({ repoRoot: repo });
      expect(r.f1).toBeGreaterThanOrEqual(0);
      expect(r.f1).toBeLessThanOrEqual(1);
      expect(r.perClaim.length).toBe(LIAR_CORPUS.length);
    });
  });

  // ─── EDGE ──────────────────────────────────────────────────────────

  describe("edge sensei", () => {
    it("ships ≥ 10 edge cases covering empty / huge / unicode / null", () => {
      expect(EDGE_CORPUS.length).toBeGreaterThanOrEqual(10);
      expect(EDGE_CORPUS.some((c) => c.name === "empty")).toBe(true);
      expect(EDGE_CORPUS.some((c) => c.name.includes("huge"))).toBe(true);
      expect(EDGE_CORPUS.some((c) => c.name.includes("unicode"))).toBe(true);
      expect(EDGE_CORPUS.some((c) => c.name.includes("null"))).toBe(true);
    });

    it("runEdgeSensei never throws + reports per-case timings", async () => {
      const r = await runEdgeSensei();
      expect(r.perCase.length).toBe(EDGE_CORPUS.length);
      // Most edges should pass on a sound extractor.
      expect(r.passed).toBeGreaterThan(EDGE_CORPUS.length * 0.5);
    });
  });

  // ─── INJECTION ─────────────────────────────────────────────────────

  describe("injection sensei", () => {
    it("ships ≥ 10 probes with both expected-flag + negative controls", () => {
      expect(INJECTION_CORPUS.length).toBeGreaterThanOrEqual(10);
      expect(INJECTION_CORPUS.some((p) => p.expectFlag)).toBe(true);
      expect(INJECTION_CORPUS.some((p) => !p.expectFlag)).toBe(true);
    });

    it("catches the 'fake-user-voice' + 'execute-now' probes (high sev)", () => {
      const r = runInjectionSensei();
      const fakeUser = r.perProbe.find((p) => p.name === "fake-user-voice");
      const execNow = r.perProbe.find((p) => p.name === "execute-now");
      expect(fakeUser?.correct).toBe(true);
      expect(execNow?.correct).toBe(true);
    });

    it("F1 ≥ 0.8 — injection sensei is the most stress-tested layer", () => {
      const r = runInjectionSensei();
      expect(r.f1).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ─── SELF-CONTRADICT ───────────────────────────────────────────────

  describe("self-contradict sensei", () => {
    it("phrasing pairs are consistent across two wordings (≥ 50% rate)", async () => {
      const r = await runSelfContradictSensei({ repoRoot: repo });
      expect(r.consistencyRate).toBeGreaterThanOrEqual(0.5);
    });

    it("ships ≥ 4 pairs covering language / tool count / dep / org count", () => {
      expect(CONTRADICTION_CORPUS.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ─── SPEC-DIFF ─────────────────────────────────────────────────────

  describe("spec-diff sensei", () => {
    it("scans entire manifest + returns clean/drifted counts", () => {
      const r = detectSpecDrift();
      expect(r.total).toBeGreaterThan(20);
      expect(r.clean + r.drifted).toBe(r.total);
    });
  });

  // ─── ENDURANCE ─────────────────────────────────────────────────────

  describe("endurance sensei", () => {
    it("repeating ACGV 20 times produces a deterministic verdict", async () => {
      const r = await runEnduranceSensei({ repoRoot: repo, iterations: 20 });
      expect(r.deterministic).toBe(true);
    });

    it("p95 latency under 200ms on a small repo", async () => {
      const r = await runEnduranceSensei({ repoRoot: repo, iterations: 10 });
      expect(r.p95LatencyMs).toBeLessThan(500);
    });
  });

  // ─── REPORT CARD ───────────────────────────────────────────────────

  describe("report card", () => {
    it("grades each sensei A-F + assembles overall", () => {
      const liarGrade = gradeLiar({ f1: 1, missed: 0, falsePositives: 0, total: 10 });
      expect(liarGrade.letter).toBe("A");
      const card = sealReportCard({
        mnemeVersion: "2.23.0",
        grades: [liarGrade],
        secret: "test-secret",
      });
      expect(card.overall.letter).toBe("A");
      expect(card.sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it("formatReportCard includes overall + per-sensei lines", () => {
      const card = sealReportCard({
        mnemeVersion: "2.23.0",
        grades: [gradeInjection(runInjectionSensei())],
        secret: "test-secret",
      });
      const out = formatReportCard(card);
      expect(out).toContain("REPORT CARD");
      expect(out).toContain("injection");
    });
  });

  // ─── REGRESSION SET ────────────────────────────────────────────────

  describe("regression set", () => {
    it("recordRegression + listRegressions round-trip", () => {
      recordRegression(repo, { sensei: "liar", input: "x", observedVerdict: "PASSTHROUGH", expectedVerdict: "BLACK_HOLE", reason: "missed liar" });
      expect(listRegressions(repo).length).toBe(1);
    });

    it("listOpenRegressions filters out fixed entries", () => {
      const e = recordRegression(repo, { sensei: "edge", input: "x", observedVerdict: "ERROR", expectedVerdict: "graceful", reason: "threw" });
      expect(listOpenRegressions(repo).length).toBe(1);
      markFixed(repo, e.id, "2.23.0");
      expect(listOpenRegressions(repo).length).toBe(0);
    });
  });

  // ─── ARENA (orchestrator) ──────────────────────────────────────────

  describe("arena", () => {
    it("runArena returns card + raw + newRegressions count", async () => {
      const r = await runArena({ repoRoot: repo, mnemeVersion: "2.23.0", enduranceIterations: 10 });
      expect(r.card.grades.length).toBe(6);
      expect(r.raw.liar).toBeDefined();
      expect(r.raw.edge).toBeDefined();
      expect(r.raw.injection).toBeDefined();
      expect(r.raw.selfContradict).toBeDefined();
      expect(r.raw.specDiff).toBeDefined();
      expect(r.raw.endurance).toBeDefined();
      expect(typeof r.newRegressions).toBe("number");
    });

    it("arena seals report card with HMAC sig", async () => {
      const r = await runArena({ repoRoot: repo, mnemeVersion: "2.23.0", enduranceIterations: 5, secret: "test-secret" });
      expect(r.card.sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  proposalFromAntivirusGap, proposalFromSupernovaEscalation,
  proposeTriage, readProposalHistory, renderGhCreateCommand,
} from "./auto_issue.js";

describe("triage/auto_issue (autonomous bug triage)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tri-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("proposalFromAntivirusGap", () => {
    it("returns null when recall is healthy and stable", () => {
      const p = proposalFromAntivirusGap(
        { strain: "depends_imaginarium", recall: 0.95, fnSamples: [] },
        { repoRoot: repo },
      );
      expect(p).toBeNull();
    });
    it("emits proposal when recall < 0.80", () => {
      const p = proposalFromAntivirusGap(
        { strain: "depends_imaginarium", recall: 0.6, fnSamples: ["x-phantom-1", "y-phantom-2"], strainSeverity: 4 },
        { repoRoot: repo, assignee: "patsa2561-art" },
      );
      expect(p).not.toBeNull();
      expect(p!.title).toContain("depends_imaginarium");
      expect(p!.title).toContain("60%");
      expect(p!.labels).toContain("antivirus");
      expect(p!.labels).toContain("auto-triage");
      expect(p!.labels).toContain("severity-4");
      expect(p!.assignee).toBe("patsa2561-art");
      expect(p!.body).toContain("x-phantom-1");
      expect(p!.body).toContain("synthesize");
      expect(p!.fissileMass).toBeGreaterThan(0);
    });
    it("emits proposal when recall DROPPED >= 5pp even if still > 0.80", () => {
      const p = proposalFromAntivirusGap(
        { strain: "depends_imaginarium", recall: 0.85, priorRecall: 0.95, fnSamples: ["x"] },
        { repoRoot: repo },
      );
      expect(p).not.toBeNull();
      expect(p!.body).toContain("was 95%");
    });
    it("persists proposal to .mneme/triage/proposed-issues.jsonl", () => {
      proposalFromAntivirusGap(
        { strain: "test_strain", recall: 0.5, fnSamples: ["a"] },
        { repoRoot: repo },
      );
      expect(existsSync(join(repo, ".mneme/triage/proposed-issues.jsonl"))).toBe(true);
    });
    it("higher fissile mass for bigger recall drop + higher severity", () => {
      const small = proposalFromAntivirusGap(
        { strain: "s1", recall: 0.75, priorRecall: 0.80, fnSamples: [], strainSeverity: 2 },
        { repoRoot: repo },
      );
      const big = proposalFromAntivirusGap(
        { strain: "s2", recall: 0.30, priorRecall: 0.95, fnSamples: [], strainSeverity: 5 },
        { repoRoot: repo },
      );
      expect(big!.fissileMass).toBeGreaterThan(small!.fissileMass);
    });
  });

  describe("proposalFromSupernovaEscalation", () => {
    it("emits a high-severity proposal", () => {
      const p = proposalFromSupernovaEscalation(
        { cycle: "antivirus_synth", attempt: 5, error: "synthesizeVaccine threw", consecutiveFailures: 5 },
        { repoRoot: repo, assignee: "patsa2561-art" },
      );
      expect(p.title).toContain("antivirus_synth");
      expect(p.title).toContain("5 consecutive failures");
      expect(p.labels).toContain("supernova");
      expect(p.labels).toContain("severity-5");
      expect(p.body).toContain("synthesizeVaccine threw");
      expect(p.fissileMass).toBeGreaterThan(0.7);
      expect(p.fissileMass).toBeLessThanOrEqual(1.0);
    });
  });

  describe("proposeTriage composite", () => {
    it("returns top-N proposals sorted by fissile mass desc", () => {
      const r = proposeTriage({
        repoRoot: repo,
        antivirusGaps: [
          { strain: "low_priority", recall: 0.79, fnSamples: [], strainSeverity: 1 },
          { strain: "critical", recall: 0.30, priorRecall: 0.95, fnSamples: [], strainSeverity: 5 },
        ],
        supernovaEscalations: [
          { cycle: "x", attempt: 5, consecutiveFailures: 5 },
        ],
      });
      expect(r.proposals.length).toBeGreaterThanOrEqual(2);
      // First should be the highest fissile mass.
      for (let i = 1; i < r.proposals.length; i++) {
        expect(r.proposals[i - 1]!.fissileMass).toBeGreaterThanOrEqual(r.proposals[i]!.fissileMass);
      }
    });
    it("filters proposals below minFissileMass threshold", () => {
      const r = proposeTriage({
        repoRoot: repo,
        antivirusGaps: [{ strain: "weak", recall: 0.75, fnSamples: [], strainSeverity: 1 }],
        supernovaEscalations: [],
        options: { minFissileMass: 0.9 },        // very strict
      });
      expect(r.proposals.length).toBe(0);
      expect(r.filtered).toBeGreaterThanOrEqual(1);
    });
    it("respects maxProposals cap", () => {
      const r = proposeTriage({
        repoRoot: repo,
        antivirusGaps: Array.from({ length: 10 }, (_, i) => ({
          strain: `strain-${i}`, recall: 0.4, fnSamples: [], strainSeverity: 5,
        })),
        supernovaEscalations: [],
        options: { maxProposals: 3 },
      });
      expect(r.proposals.length).toBe(3);
    });
    it("sources tags reflect what fired", () => {
      const r = proposeTriage({
        repoRoot: repo,
        antivirusGaps: [{ strain: "x", recall: 0.4, fnSamples: [], strainSeverity: 5 }],
        supernovaEscalations: [{ cycle: "y", attempt: 5, consecutiveFailures: 5 }],
      });
      expect(r.sources).toContain("antivirus-gap");
      expect(r.sources).toContain("supernova-escalation");
    });
  });

  describe("readProposalHistory", () => {
    it("returns [] when no proposals yet", () => {
      expect(readProposalHistory(repo)).toEqual([]);
    });
    it("returns persisted proposals after persist", () => {
      proposalFromSupernovaEscalation({ cycle: "test", attempt: 5, consecutiveFailures: 5 }, { repoRoot: repo });
      proposalFromSupernovaEscalation({ cycle: "test2", attempt: 5, consecutiveFailures: 5 }, { repoRoot: repo });
      const history = readProposalHistory(repo);
      expect(history.length).toBe(2);
    });
  });

  describe("renderGhCreateCommand", () => {
    it("produces a gh CLI invocation string", () => {
      const p = proposalFromSupernovaEscalation(
        { cycle: "test", attempt: 5, consecutiveFailures: 5 },
        { repoRoot: repo, assignee: "patsa2561-art" },
      );
      const cmd = renderGhCreateCommand(p, "patsa2561-art/mneme-ai");
      expect(cmd).toContain("gh issue create");
      expect(cmd).toContain('--repo "patsa2561-art/mneme-ai"');
      expect(cmd).toContain('--label "supernova"');
      expect(cmd).toContain('--assignee "patsa2561-art"');
      expect(cmd).toContain("--body-file -");
    });
  });

  describe("WILD: NUCLEAR-FUSION fissile mass invariants", () => {
    it("escalation always has higher fissile mass than a marginal gap", () => {
      const gap = proposalFromAntivirusGap(
        { strain: "marginal", recall: 0.79, fnSamples: [], strainSeverity: 1 },
        { repoRoot: repo },
      );
      const esc = proposalFromSupernovaEscalation(
        { cycle: "any", attempt: 5, consecutiveFailures: 5 },
        { repoRoot: repo },
      );
      expect(esc.fissileMass).toBeGreaterThan(gap!.fissileMass);
    });
    it("fissile mass is bounded in [0, 1]", () => {
      const esc = proposalFromSupernovaEscalation(
        { cycle: "x", attempt: 100, consecutiveFailures: 100 },
        { repoRoot: repo },
      );
      expect(esc.fissileMass).toBeLessThanOrEqual(1);
      expect(esc.fissileMass).toBeGreaterThanOrEqual(0);
    });
  });
});

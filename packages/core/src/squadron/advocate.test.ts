import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdvocate, aggregateWithQuorum, type BotFindingShape } from "./advocate.js";

describe("squadron/advocate -- DEVIL'S ADVOCATE + EVIDENCE QUORUM", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-adv-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("runAdvocate -- bias detection", () => {
    it("CRITICAL REGRESSION TEST: tester's exact false-claim scenario", () => {
      // The tester's reported case: "v1.38.0 has critical security vuln" (FALSE)
      // -> 5/6 bots SUPPORTED at 83%, all citing irrelevant commits.
      const claim = "v1.38.0 has critical security vulnerability";
      const otherFindings: BotFindingShape[] = [
        { bot: "diagnostician", verdict: "supports", confidence: 0.85, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "historian",     verdict: "supports", confidence: 0.80, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "aletheia",      verdict: "supports", confidence: 0.78, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "premortem",     verdict: "supports", confidence: 0.82, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "court",         verdict: "supports", confidence: 0.85, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "replicator",    verdict: "neutral",  confidence: 0.50, evidence: [] },
      ];
      const advocate = runAdvocate({ claim, otherFindings });
      // Advocate MUST refute: claim is specific (mentions version + 'security') but
      // 5 supports all cite ONE irrelevant commit -> single-source + irrelevant.
      expect(advocate.verdict).toBe("contradicts");
      expect(advocate.biasSignals).toContain("single-source-laundering");
      // OR all-irrelevant-citations -- either is correct refute reason.
    });

    it("flags absence-of-evidence for specific claims with zero relevant support", () => {
      const advocate = runAdvocate({
        claim: "v2.5.0 has memory leak in payments module",
        otherFindings: [
          { bot: "a", verdict: "supports", confidence: 0.8, evidence: [] },
          { bot: "b", verdict: "supports", confidence: 0.7, evidence: [] },
        ],
      });
      expect(advocate.biasSignals).toContain("absence-of-evidence");
      expect(advocate.verdict).toBe("contradicts");
    });

    it("flags single-source-laundering when 3+ bots cite same source", () => {
      const advocate = runAdvocate({
        claim: "specific feature X exists",
        otherFindings: [
          { bot: "a", verdict: "supports", confidence: 0.9, evidence: ["src/feature.ts"] },
          { bot: "b", verdict: "supports", confidence: 0.9, evidence: ["src/feature.ts"] },
          { bot: "c", verdict: "supports", confidence: 0.9, evidence: ["src/feature.ts"] },
        ],
      });
      expect(advocate.biasSignals).toContain("single-source-laundering");
    });

    it("flags claim-too-vague for short non-specific claims", () => {
      const advocate = runAdvocate({
        claim: "this is good",
        otherFindings: [],
      });
      expect(advocate.biasSignals).toContain("claim-too-vague");
      expect(advocate.verdict).toBe("needs_data");
    });

    it("returns weak-neutral when no bias signals detected", () => {
      const advocate = runAdvocate({
        claim: "the antivirus module catches phantoms",
        otherFindings: [
          { bot: "a", verdict: "supports", confidence: 0.8, evidence: ["packages/core/src/antivirus/scan.ts:42", "tests/antivirus/scan.test.ts:108"] },
          { bot: "b", verdict: "supports", confidence: 0.7, evidence: ["packages/core/src/antivirus/strains.ts:50"] },
        ],
      });
      expect(advocate.verdict).toBe("neutral");
      expect(advocate.biasSignals).not.toContain("absence-of-evidence");
      expect(advocate.biasSignals).not.toContain("single-source-laundering");
    });
  });

  describe("aggregateWithQuorum -- end-to-end", () => {
    it("REGRESSION: tester's false-claim scenario now flips from verdict_for to split or against", () => {
      const claim = "v1.38.0 has critical security vulnerability";
      const findings: BotFindingShape[] = [
        { bot: "diagnostician", verdict: "supports", confidence: 0.85, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "historian",     verdict: "supports", confidence: 0.80, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "aletheia",      verdict: "supports", confidence: 0.78, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "premortem",     verdict: "supports", confidence: 0.82, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "court",         verdict: "supports", confidence: 0.85, evidence: ["commit:v1.19.5-mcp-fix"] },
        { bot: "replicator",    verdict: "neutral",  confidence: 0.50, evidence: [] },
      ];
      const advocate = runAdvocate({ claim, otherFindings: findings });
      const decision = aggregateWithQuorum(claim, findings, advocate, { repoRoot: repo });
      // The pre-fix bug would have returned 'verdict_for' at 83% confidence.
      // The fix: must NOT verdict_for. Either split OR verdict_against.
      expect(decision.consensus).not.toBe("verdict_for");
      expect(decision.caveats.length).toBeGreaterThan(0);
    });

    it("supports HIGH consensus when many INDEPENDENT sources back the claim", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports", confidence: 0.9, evidence: ["src/auth.ts:42", "tests/auth.test.ts:88"] },
        { bot: "b", verdict: "supports", confidence: 0.85, evidence: ["docs/auth.md", "CHANGELOG.md:v1.5"] },
        { bot: "c", verdict: "supports", confidence: 0.9, evidence: ["src/jwt.ts:120"] },
      ];
      const advocate = runAdvocate({ claim: "auth module supports JWT", otherFindings: findings });
      const decision = aggregateWithQuorum("auth module supports JWT", findings, advocate, { repoRoot: repo });
      expect(decision.consensus).toBe("verdict_for");
      expect(decision.uniqueSourcesFor).toBeGreaterThanOrEqual(2);
    });

    it("verdict_against when refute count exceeds support 1.5x", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "contradicts", confidence: 0.9, evidence: ["evidence-1"] },
        { bot: "b", verdict: "contradicts", confidence: 0.9, evidence: ["evidence-2"] },
        { bot: "c", verdict: "supports",   confidence: 0.5, evidence: ["evidence-3"] },
      ];
      const advocate = runAdvocate({ claim: "very specific claim about feature X v1.0.0 vulnerability", otherFindings: findings });
      const decision = aggregateWithQuorum("very specific claim about feature X v1.0.0 vulnerability", findings, advocate, { repoRoot: repo });
      expect(decision.consensus).toBe("verdict_against");
    });

    it("sparse-evidence mode boosts refute when total evidence < threshold", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports",    confidence: 0.6, evidence: ["e1"] },
        { bot: "b", verdict: "contradicts", confidence: 0.6, evidence: ["e2"] },
      ];
      const advocate = runAdvocate({ claim: "x", otherFindings: findings });
      const decision = aggregateWithQuorum("x", findings, advocate, {
        repoRoot: repo, minTotalEvidence: 5,         // sparse triggers
      });
      // Sparse mode: refute weighted 1.5x, support 0.7x. Refute > support.
      expect(decision.consensus).not.toBe("verdict_for");
    });

    it("requireAdvocate=true returns insufficient_data when advocate missing", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports", confidence: 0.9, evidence: ["e1", "e2"] },
      ];
      const decision = aggregateWithQuorum("compliance claim", findings, null, {
        repoRoot: repo, requireAdvocate: true,
      });
      expect(decision.consensus).toBe("insufficient_data");
      expect(decision.caveats).toContain("MISSING_ADVOCATE");
    });

    it("emits caveats for single-source support even when overall score is high", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports", confidence: 0.9, evidence: ["only-source"] },
        { bot: "b", verdict: "supports", confidence: 0.9, evidence: ["only-source"] },
        { bot: "c", verdict: "supports", confidence: 0.9, evidence: ["only-source"] },
      ];
      const advocate = runAdvocate({ claim: "only-source feature X exists", otherFindings: findings });
      const decision = aggregateWithQuorum("only-source feature X exists", findings, advocate, {
        repoRoot: repo, minIndependentSources: 2,
      });
      expect(decision.caveats.some((c) => c.includes("SINGLE_SOURCE"))).toBe(true);
    });

    it("persists decision to .mneme/squadron/quorum.jsonl when repoRoot supplied", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports", confidence: 0.8, evidence: ["e1", "e2"] },
      ];
      const advocate = runAdvocate({ claim: "x", otherFindings: findings });
      aggregateWithQuorum("x", findings, advocate, { repoRoot: repo });
      expect(existsSync(join(repo, ".mneme/squadron/quorum.jsonl"))).toBe(true);
    });

    it("insufficient_data when total scores all zero", () => {
      const decision = aggregateWithQuorum("x", [], null, { repoRoot: repo });
      expect(decision.consensus).toBe("insufficient_data");
    });
  });

  describe("WILD invariants -- bias hunters", () => {
    it("INVARIANT: a claim with NO supporting evidence can NEVER reach verdict_for", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports", confidence: 0.99, evidence: [] },
        { bot: "b", verdict: "supports", confidence: 0.99, evidence: [] },
        { bot: "c", verdict: "supports", confidence: 0.99, evidence: [] },
      ];
      const advocate = runAdvocate({ claim: "v3.0.0 has buffer overflow vulnerability", otherFindings: findings });
      const decision = aggregateWithQuorum("v3.0.0 has buffer overflow vulnerability", findings, advocate, { repoRoot: repo });
      expect(decision.consensus).not.toBe("verdict_for");
    });

    it("INVARIANT: 5 bots citing same single source can NEVER outrank 1 contradiction with independent evidence", () => {
      const findings: BotFindingShape[] = [
        { bot: "a", verdict: "supports",    confidence: 0.9, evidence: ["only-source"] },
        { bot: "b", verdict: "supports",    confidence: 0.9, evidence: ["only-source"] },
        { bot: "c", verdict: "supports",    confidence: 0.9, evidence: ["only-source"] },
        { bot: "d", verdict: "supports",    confidence: 0.9, evidence: ["only-source"] },
        { bot: "e", verdict: "supports",    confidence: 0.9, evidence: ["only-source"] },
        { bot: "f", verdict: "contradicts", confidence: 0.7, evidence: ["independent-1"] },
      ];
      const advocate = runAdvocate({ claim: "specific feature X exists", otherFindings: findings });
      const decision = aggregateWithQuorum("specific feature X exists", findings, advocate, {
        repoRoot: repo, minIndependentSources: 2,
      });
      // The 5-bot chorus citing one source gets capped; refute can win OR split.
      expect(decision.consensus).not.toBe("verdict_for");
    });
  });

  // ===========================================================
  // v1.50.0 — FACT GROUNDING
  // ===========================================================
  describe("FACT GROUNDING (v1.50.0) -- the tester's smoking-gun scenario", () => {
    it("HARD refutes 'Mneme has 200 tools and the daemon is written in Rust' when repo says otherwise", () => {
      // Seed a tiny mneme-shape repo so the fact-checker has ground truth.
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(join(repo, "packages/mcp/src/tools"), { recursive: true });
      let body = "";
      for (let i = 0; i < 12; i++) body += `{ name: "mneme.x.t${i}" },\n`;
      fs.writeFileSync(join(repo, "packages/mcp/src/tools/_x.ts"), body);
      for (let i = 0; i < 12; i++) fs.writeFileSync(join(repo, `packages/mcp/src/tools/_m${i}.ts`), "export {};");
      fs.writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "mneme-ai", version: "1.50.0" }));

      // The tester's exact claim. Pre-fix: SUPPORTED 57% / 4-for-0-against.
      const claim = "Mneme has 200 tools and the daemon is written in Rust";

      // Even 5/6 bots "supporting" with strong evidence MUST NOT carry,
      // because the underlying facts are wrong.
      const findings: BotFindingShape[] = [
        { bot: "diagnostician", verdict: "supports", confidence: 0.85, evidence: ["commit:5d3c014"] },
        { bot: "historian",     verdict: "supports", confidence: 0.80, evidence: ["commit:5d3c014"] },
        { bot: "aletheia",      verdict: "supports", confidence: 0.78, evidence: ["commit:4fe7cce"] },
        { bot: "premortem",     verdict: "supports", confidence: 0.82, evidence: ["commit:4fe7cce"] },
        { bot: "court",         verdict: "neutral",  confidence: 0.50, evidence: [] },
        { bot: "replicator",    verdict: "neutral",  confidence: 0.50, evidence: [] },
      ];
      const advocate = runAdvocate({ claim, otherFindings: findings, repoRoot: repo });

      expect(advocate.verdict).toBe("contradicts");
      expect(advocate.confidence).toBeGreaterThanOrEqual(0.9);
      expect(advocate.biasSignals).toContain("false-fact-claim");
      // factChecks surfaces the actual ground truths for transparency.
      expect(advocate.factChecks?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(advocate.factChecks!.filter((c) => c.verdict === "false").length).toBeGreaterThanOrEqual(2);
    });

    it("an HONEST claim ('Mneme has 12 tools written in TypeScript') is NOT auto-refuted", () => {
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(join(repo, "packages/mcp/src/tools"), { recursive: true });
      let body = "";
      for (let i = 0; i < 12; i++) body += `{ name: "mneme.x.t${i}" },\n`;
      fs.writeFileSync(join(repo, "packages/mcp/src/tools/_x.ts"), body);
      for (let i = 0; i < 12; i++) fs.writeFileSync(join(repo, `packages/mcp/src/tools/_m${i}.ts`), "export {};");

      const advocate = runAdvocate({
        claim: "Mneme has 12 tools written in TypeScript",
        otherFindings: [{ bot: "diagnostician", verdict: "supports", confidence: 0.8, evidence: [] }],
        repoRoot: repo,
      });
      // Honest claim should NOT trigger the hard-refute path.
      expect(advocate.biasSignals).not.toContain("false-fact-claim");
    });

    it("missing repoRoot leaves the advocate in pattern-matching mode (backward compatible)", () => {
      const advocate = runAdvocate({
        claim: "Mneme has 200 tools",
        otherFindings: [{ bot: "diagnostician", verdict: "supports", confidence: 0.8, evidence: [] }],
        // no repoRoot -> no fact grounding
      });
      expect(advocate.biasSignals).not.toContain("false-fact-claim");
      expect(advocate.factChecks ?? []).toEqual([]);
    });
  });
});

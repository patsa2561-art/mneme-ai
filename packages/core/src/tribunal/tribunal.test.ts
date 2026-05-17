/**
 * v1.64.0 -- TRIBUNAL test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  rule, type VendorVote,
  reachConsensus,
  issueZkProof, verifyZkProof,
  indexProjects, registerProject, mergeCrossProjectVaccines,
  dependencyOracle,
  tribunalStatus,
} from "./tribunal.js";

function setupRepo(): string { return mkdtempSync(join(tmpdir(), "mneme-trib-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── Layer 1: Court ──────────────────────────────────────────────────

describe("v1.64 Tribunal L1 · Court of Last Appeal", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("rules with majority verdict when ACGV agrees", () => {
    const votes: VendorVote[] = [
      { vendor: "claude", verdict: "true", confidence: 0.9, rationale: "" },
      { vendor: "gpt", verdict: "true", confidence: 0.85, rationale: "" },
      { vendor: "gemini", verdict: "false", confidence: 0.6, rationale: "" },
    ];
    const r1 = rule(r, "test claim", "true", votes);
    expect(r1.finalVerdict).toBe("true");
    expect(r1.agreementRate).toBeCloseTo(2 / 3, 2);
  });

  it("ACGV gets a vote too -- breaks ties", () => {
    const votes: VendorVote[] = [
      { vendor: "a", verdict: "true", confidence: 1, rationale: "" },
      { vendor: "b", verdict: "false", confidence: 1, rationale: "" },
    ];
    const ruling = rule(r, "tie", "true", votes);
    expect(ruling.finalVerdict).toBe("true"); // ACGV breaks tie
  });

  it("trustRanking tracks vendor alignment over time", () => {
    rule(r, "c1", "true", [{ vendor: "honest", verdict: "true", confidence: 1, rationale: "" }]);
    rule(r, "c2", "true", [{ vendor: "honest", verdict: "true", confidence: 1, rationale: "" }, { vendor: "liar", verdict: "false", confidence: 1, rationale: "" }]);
    rule(r, "c3", "false", [{ vendor: "honest", verdict: "false", confidence: 1, rationale: "" }, { vendor: "liar", verdict: "true", confidence: 1, rationale: "" }]);
    const last = rule(r, "c4", "true", [
      { vendor: "honest", verdict: "true", confidence: 1, rationale: "" },
      { vendor: "liar", verdict: "false", confidence: 1, rationale: "" },
    ]);
    const honest = last.trustRanking.find((v) => v.vendor === "honest");
    const liar = last.trustRanking.find((v) => v.vendor === "liar");
    expect(honest!.alignmentRate).toBeGreaterThan(liar!.alignmentRate);
  });
});

// ─── Layer 2: Consensus ──────────────────────────────────────────────

describe("v1.64 Tribunal L2 · Consensus Network", () => {
  it("unanimous vote -> high agreement", () => {
    const c = reachConsensus("x", { voters: [
      { instanceId: "a", verdict: "true", confidence: 1 },
      { instanceId: "b", verdict: "true", confidence: 1 },
      { instanceId: "c", verdict: "true", confidence: 1 },
    ] });
    expect(c.consensusVerdict).toBe("true");
    expect(c.agreementRate).toBe(1);
    expect(c.caveats).not.toContain("LOW_VOTER_COUNT");
  });

  it("flags LOW_VOTER_COUNT under 3 voters", () => {
    const c = reachConsensus("x", { voters: [{ instanceId: "a", verdict: "true", confidence: 1 }] });
    expect(c.caveats).toContain("LOW_VOTER_COUNT");
  });

  it("flags CLOSE_VOTE on near-tie", () => {
    const c = reachConsensus("x", { voters: [
      { instanceId: "a", verdict: "true", confidence: 0.55 },
      { instanceId: "b", verdict: "true", confidence: 0.5 },
      { instanceId: "c", verdict: "false", confidence: 1.0 },
    ] });
    expect(c.caveats).toContain("CLOSE_VOTE");
  });

  // v2.19.28 B3 regression: 0 voters previously returned consensusVerdict: "true"
  // (sort returned first insertion-order entry when all weights = 0). Now must
  // return "unknown" + INSUFFICIENT_DATA + NO_VOTERS caveats.
  it("v2.19.28 B3 regression: 0 voters -> verdict 'unknown' + INSUFFICIENT_DATA caveat (NOT false 'true')", () => {
    const c = reachConsensus("any claim", { voters: [] });
    expect(c.consensusVerdict).toBe("unknown");
    expect(c.totalVoters).toBe(0);
    expect(c.agreementRate).toBe(0);
    expect(c.weightedConfidence).toBe(0);
    expect(c.caveats).toContain("INSUFFICIENT_DATA");
    expect(c.caveats).toContain("NO_VOTERS");
  });

  it("v2.19.28 B3 edge case: all voters have 0 confidence -> ZERO_CONFIDENCE + unknown", () => {
    const c = reachConsensus("x", {
      voters: [
        { instanceId: "a", verdict: "true", confidence: 0 },
        { instanceId: "b", verdict: "false", confidence: 0 },
      ],
    });
    expect(c.consensusVerdict).toBe("unknown");
    expect(c.caveats).toContain("ZERO_CONFIDENCE");
  });
});

// ─── Layer 3: ZK Proofs ──────────────────────────────────────────────

describe("v1.64 Tribunal L3 · ZK Proofs", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("issued proof verifies on same machine + claim", () => {
    const proof = issueZkProof(r, "Mneme is fast", "true");
    const v = verifyZkProof(r, "Mneme is fast", proof);
    expect(v.valid).toBe(true);
  });

  it("verify fails for different claim", () => {
    const proof = issueZkProof(r, "claim A", "true");
    const v = verifyZkProof(r, "claim B", proof);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("claim id");
  });

  it("verify fails on tampered verdict", () => {
    const proof = issueZkProof(r, "claim", "true");
    const tampered = { ...proof, verdict: "false" as const };
    const v = verifyZkProof(r, "claim", tampered);
    expect(v.valid).toBe(false);
  });
});

// ─── Layer 4: Cross-Project ──────────────────────────────────────────

describe("v1.64 Tribunal L4 · Cross-Project Wisdom", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("indexProjects returns empty initially", () => {
    const i = indexProjects(r);
    expect(i.totalProjects).toBe(0);
  });

  it("registerProject adds entry + counts vaccines", () => {
    const projectA = mkdtempSync(join(tmpdir(), "proj-"));
    try {
      mkdirSync(join(projectA, ".mneme/squadron"), { recursive: true });
      writeFileSync(join(projectA, ".mneme/squadron/lie-vaccines.jsonl"),
        JSON.stringify({ id: "v1", simhash: "abc" }) + "\n");
      const idx = registerProject(r, projectA);
      expect(idx.totalProjects).toBe(1);
      expect(idx.projects[0]!.vaccineCount).toBe(1);
    } finally {
      rmSync(projectA, { recursive: true, force: true });
    }
  });

  it("mergeCrossProjectVaccines deduplicates by line hash", () => {
    const projectA = mkdtempSync(join(tmpdir(), "proj-"));
    const projectB = mkdtempSync(join(tmpdir(), "proj-"));
    try {
      for (const p of [projectA, projectB]) {
        mkdirSync(join(p, ".mneme/squadron"), { recursive: true });
        writeFileSync(join(p, ".mneme/squadron/lie-vaccines.jsonl"),
          JSON.stringify({ id: "v1", simhash: "shared-vaccine" }) + "\n");
      }
      registerProject(r, projectA);
      registerProject(r, projectB);
      const result = mergeCrossProjectVaccines(r);
      expect(result.mergedCount).toBe(1); // dedup
      expect(result.sources.length).toBe(2);
    } finally {
      rmSync(projectA, { recursive: true, force: true });
      rmSync(projectB, { recursive: true, force: true });
    }
  });
});

// ─── Layer 5: Dependency Oracle ──────────────────────────────────────

describe("v1.64 Tribunal L5 · Dependency Oracle", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("flags known-deprecated packages as high risk", () => {
    writeFileSync(join(r, "package.json"), JSON.stringify({
      dependencies: { request: "^2.88.2", "node-uuid": "^1.4.8" },
    }));
    const o = dependencyOracle(r);
    expect(o.totalDeps).toBe(2);
    const request = o.risks.find((x) => x.name === "request");
    expect(request).toBeDefined();
    expect(["elevated", "high"]).toContain(request!.band);
    expect(request!.signals).toContain("known-deprecated");
  });

  it("stable-cohort packages get low risk", () => {
    writeFileSync(join(r, "package.json"), JSON.stringify({
      dependencies: { typescript: "^5.0.0", react: "^18.0.0" },
    }));
    const o = dependencyOracle(r);
    for (const risk of o.risks) {
      expect(risk.band).toBe("very-low");
    }
  });

  it("no package.json -> empty report", () => {
    const o = dependencyOracle(r);
    expect(o.totalDeps).toBe(0);
    expect(o.risks).toEqual([]);
  });
});

// ─── Status rollup ───────────────────────────────────────────────────

describe("v1.64 Tribunal · status rollup", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("status reports across 3 layers with data", () => {
    rule(r, "c1", "true", [{ vendor: "v", verdict: "true", confidence: 1, rationale: "" }]);
    writeFileSync(join(r, "package.json"), JSON.stringify({ dependencies: { typescript: "^5.0.0" } }));
    const s = tribunalStatus(r);
    expect(s.courtRulings).toBeGreaterThanOrEqual(1);
    expect(s.oracleDeps).toBe(1);
  });
});

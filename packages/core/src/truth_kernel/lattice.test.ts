/**
 * v2.89.0 — 💎 AXIOM LATTICE tests (ALETHEIA's living proof graph).
 *
 *   L1  record + read round-trip; node is signed + hash-chained
 *   L2  contradiction: opposite-verdict (same subject, TRUE vs FALSE)
 *   L3  contradiction: negation-pair (X vs not-X, both TRUE)
 *   L4  contradiction: value-conflict (subject = two different values, both TRUE)
 *   L5  no false contradiction across DIFFERENT subjects / against UNKNOWN
 *   L6  whyTrue walks the proof to bedrock (deterministic) through dependencies
 *   L7  retract CASCADE — dependents → PENDING_REVERIFY + signed frame
 *   L8  verifyLattice OFFLINE — clean chain ok; tamper the body → caught; forge a
 *       receipt verdict → caught; break the chain (delete a middle node) → caught
 *   L9  latticeStatus counts (active/retracted/pending) + open contradictions
 *   L10 QUAN — never throws over fuzz; chain stays valid across N random records
 *   L11 assertClaim({record}) persists + surfaces contradictions end-to-end
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordAssertion, detectContradictions, whyTrue, retract, latticeStatus,
  verifyLattice, readLattice, normalizeSubject, type LatticeNode,
} from "./lattice.js";
import { assertClaim } from "./aletheia.js";

function repo(): string { return mkdtempSync(join(tmpdir(), "lattice-")); }
const T = 1_700_000_000_000;
function latPath(r: string): string { return join(r, ".mneme", "aletheia", "lattice.jsonl"); }

describe("v2.89.0 💎 AXIOM LATTICE — ALETHEIA's living proof graph", () => {
  it("L1 record + read round-trip; node is signed + hash-chained", () => {
    const r = repo();
    const a = recordAssertion(r, { claim: "2+2=4", verdict: "TRUE", pTrue: 1, lineageSummary: ["arithmetic"] }, { issuedAt: T });
    expect(a.node.verdict).toBe("TRUE");
    expect(a.node.receipt).not.toBeNull();
    expect(a.node.prev).toBeNull(); // first node = root
    const b = recordAssertion(r, { claim: "10*10=100", verdict: "TRUE", pTrue: 1, lineageSummary: ["arithmetic"] }, { issuedAt: T });
    expect(b.node.prev).toBe(a.node.receipt!.receiptId); // chained
    expect(readLattice(r).length).toBe(2);
  });

  it("L2 contradiction: opposite-verdict", () => {
    const r = repo();
    recordAssertion(r, { claim: "2+2=4", verdict: "TRUE", pTrue: 1, lineageSummary: ["arithmetic"] }, { issuedAt: T });
    const c = recordAssertion(r, { claim: "2+2=4", verdict: "FALSE", pTrue: 0, lineageSummary: ["arithmetic"] }, { issuedAt: T });
    expect(c.contradictions.map((x) => x.kind)).toContain("opposite-verdict");
  });

  it("L3 contradiction: negation-pair", () => {
    const r = repo();
    recordAssertion(r, { claim: "mneme is written in TypeScript", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    const c = recordAssertion(r, { claim: "mneme is not written in TypeScript", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    expect(c.contradictions.map((x) => x.kind)).toContain("negation-pair");
  });

  it("L4 contradiction: value-conflict", () => {
    const r = repo();
    recordAssertion(r, { claim: "the project version is 1.2", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    const c = recordAssertion(r, { claim: "the project version is 1.3", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    expect(c.contradictions.map((x) => x.kind)).toContain("value-conflict");
  });

  it("L5 no false contradiction across different subjects / against UNKNOWN", () => {
    const r = repo();
    recordAssertion(r, { claim: "the sky is blue", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    expect(detectContradictions(r, "the grass is green", "TRUE").length).toBe(0); // different subject
    expect(detectContradictions(r, "the sky is blue", "UNKNOWN").length).toBe(0); // UNKNOWN asserts nothing
    // re-affirming the SAME claim+verdict is not a contradiction
    expect(detectContradictions(r, "the sky is blue", "TRUE").length).toBe(0);
  });

  it("L6 whyTrue walks the proof to bedrock through dependencies", () => {
    const r = repo();
    const a = recordAssertion(r, { claim: "2+2=4", verdict: "TRUE", pTrue: 1, lineageSummary: ["arithmetic"] }, { issuedAt: T });
    const b = recordAssertion(r, { claim: "the sum check passes", verdict: "TRUE", pTrue: 0.9, lineageSummary: ["apoptosis"] }, { issuedAt: T, dependsOn: [a.node.id] });
    const w = whyTrue(r, b.node.id);
    expect(w.found).toBe(true);
    expect(w.proof.length).toBeGreaterThanOrEqual(2);
    expect(w.proof.some((l) => l.includes("bedrock"))).toBe(true); // reaches the deterministic axiom
    expect(whyTrue(r, "no such claim").found).toBe(false);
  });

  it("L7 retract CASCADE — dependents → PENDING_REVERIFY + signed frame", () => {
    const r = repo();
    const a = recordAssertion(r, { claim: "base fact", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    const b = recordAssertion(r, { claim: "derived from base", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T, dependsOn: [a.node.id] });
    const c = recordAssertion(r, { claim: "derived from derived", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T, dependsOn: [b.node.id] });
    const res = retract(r, a.node.id, "refuted", { issuedAt: T });
    expect(res.retracted).toContain(a.node.id);
    expect(res.cascade).toContain(b.node.id); // direct dependent
    expect(res.cascade).toContain(c.node.id); // transitive dependent
    expect(res.retractionReceiptId).not.toBeNull();
    const nodes = readLattice(r);
    expect(nodes.find((n) => n.id === a.node.id)!.status).toBe("RETRACTED");
    expect(nodes.find((n) => n.id === b.node.id)!.status).toBe("PENDING_REVERIFY");
    expect(nodes.find((n) => n.id === c.node.id)!.status).toBe("PENDING_REVERIFY");
  });

  it("L8 verifyLattice OFFLINE — clean ok; body-tamper / forged-receipt / broken-chain all caught", () => {
    const mk = (): string => {
      const r = repo();
      recordAssertion(r, { claim: "alpha is true", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
      recordAssertion(r, { claim: "beta is true", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
      recordAssertion(r, { claim: "gamma is true", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
      return r;
    };
    // clean
    expect(verifyLattice(mk()).ok).toBe(true);
    // (a) tamper the NODE BODY (flip a verdict in the jsonl) → mismatch vs signed payload
    {
      const r = mk();
      const nodes = readLattice(r);
      nodes[1]!.verdict = "FALSE";
      writeFileSync(latPath(r), nodes.map((n) => JSON.stringify(n)).join("\n") + "\n", "utf8");
      const v = verifyLattice(r);
      expect(v.ok).toBe(false);
      expect(v.badSignatures).toContain(nodes[1]!.id);
    }
    // (b) forge the VERDICT inside the signed receipt payload → Ed25519 sig breaks
    {
      const r = mk();
      const nodes = readLattice(r);
      (nodes[1]!.receipt!.payload as { verdict?: string }).verdict = "FALSE";
      nodes[1]!.verdict = "FALSE"; // keep body consistent so only the sig check fails
      writeFileSync(latPath(r), nodes.map((n) => JSON.stringify(n)).join("\n") + "\n", "utf8");
      expect(verifyLattice(r).ok).toBe(false);
    }
    // (c) break the CHAIN — delete the middle node so prev no longer matches
    {
      const r = mk();
      const nodes = readLattice(r);
      const without = [nodes[0]!, nodes[2]!];
      writeFileSync(latPath(r), without.map((n) => JSON.stringify(n)).join("\n") + "\n", "utf8");
      const v = verifyLattice(r);
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBe(nodes[2]!.seq);
    }
  });

  it("L9 latticeStatus counts + open contradictions among ACTIVE truths only", () => {
    const r = repo();
    recordAssertion(r, { claim: "x is red", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    recordAssertion(r, { claim: "x is not red", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T }); // contradiction
    const a = recordAssertion(r, { claim: "y is fine", verdict: "TRUE", pTrue: 0.9 }, { issuedAt: T });
    let s = latticeStatus(r);
    expect(s.nodes).toBe(3);
    expect(s.active).toBe(3);
    expect(s.openContradictions).toBe(1);
    expect(s.chainValid).toBe(true);
    // retracting one side closes the contradiction
    retract(r, a.node.id, "n/a", { issuedAt: T });
    retract(r, readLattice(r)[1]!.id, "resolved", { issuedAt: T });
    s = latticeStatus(r);
    expect(s.openContradictions).toBe(0);
    expect(s.retracted).toBe(2);
  });

  it("L10 QUAN — never throws over fuzz; chain stays valid across random records", () => {
    const r = repo();
    for (let i = 0; i < 50; i++) {
      const claim = ["", "   ", `fact ${i}`, `v = ${i}`, `${i}+${i}=${i * 2}`, "weird﻿   chars", `${i} is not ${i}`][i % 7]!;
      const verdict = (["TRUE", "FALSE", "UNKNOWN"] as const)[i % 3]!;
      expect(() => recordAssertion(r, { claim, verdict, pTrue: (i % 10) / 10 }, { issuedAt: T })).not.toThrow();
    }
    expect(verifyLattice(r).ok).toBe(true);
    expect(() => latticeStatus(r)).not.toThrow();
    expect(() => normalizeSubject("")).not.toThrow();
    expect(() => whyTrue(r, "nothing")).not.toThrow();
    expect(() => retract(r, "nothing", "x", { issuedAt: T })).not.toThrow();
  });

  it("L11 assertClaim({record}) persists + surfaces contradictions end-to-end", async () => {
    const r = repo();
    const t1 = await assertClaim(r, "2+2=4", { record: true, issuedAt: T });
    expect(t1.verdict).toBe("TRUE");
    expect(t1.latticeNodeId).toBeTruthy();
    expect(t1.contradictions).toEqual([]);
    // assert the SAME subject with the opposite truth → contradiction surfaced inline
    // (force it via custom sensor so we get a definite FALSE on the same subject)
    const t2 = await assertClaim(r, "2+2=4", {
      record: true, issuedAt: T,
      sensors: [{ id: "forced", weight: 2, run: () => ({ sensor: "forced", verdict: "FALSE", confidence: 1 }) }],
    });
    expect(t2.verdict).toBe("FALSE");
    expect(t2.contradictions?.some((c) => c.kind === "opposite-verdict")).toBe(true);
    expect(verifyLattice(r).ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { DreamConsolidation, formatDreamLine } from "./index.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mneme-dream-"));
  return new DreamConsolidation({ storePath: join(dir, "candidates.jsonl") });
}

describe("v2.19.7 · DREAM CONSOLIDATION", () => {
  it("emits zero candidates when axioms have no overlap", () => {
    const d = fresh();
    const r = d.runCycle({
      axioms: [
        { axiomId: "a1", body: "apples are red fruits" },
        { axiomId: "a2", body: "spaceships travel through interstellar void" },
      ],
    });
    expect(r.candidatesEmitted).toBe(0);
  });

  it("emits a candidate when two axioms share overlap above threshold", () => {
    const d = fresh();
    const r = d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0,
    });
    expect(r.candidatesEmitted).toBeGreaterThanOrEqual(1);
    expect(r.candidates[0]!.parents).toEqual(["a1", "a2"]);
    expect(r.candidates[0]!.parentOverlap).toBeGreaterThan(0);
  });

  it("respects maxCandidates cap", () => {
    const d = fresh();
    const axioms = Array.from({ length: 10 }, (_, i) => ({ axiomId: `a${i}`, body: `shared concept tokens common fact number ${i}` }));
    const r = d.runCycle({ axioms, maxCandidates: 3, pairThreshold: 0.1, noveltyThreshold: 0.0 });
    expect(r.candidatesEmitted).toBeLessThanOrEqual(3);
  });

  it("HMAC-signs candidates + verify catches tampering", () => {
    const d = fresh();
    const r = d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0,
    });
    const c = r.candidates[0]!;
    expect(d.verify(c)).toBe(true);
    const tampered = { ...c, body: "EVIL TWIN" };
    expect(d.verify(tampered)).toBe(false);
  });

  it("confirm + refute update status + re-sign", () => {
    const d = fresh();
    d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0,
    });
    const pending = d.pendingReview();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const c = d.confirm({ candidateId: pending[0]!.candidateId, reason: "actually true" });
    expect(c).not.toBeNull();
    expect(c!.status).toBe("confirmed");
    expect(d.verify(c!)).toBe(true);
  });

  it("sweepExpired marks past-TTL pending as expired", () => {
    const d = fresh();
    const t0 = 1_000_000_000_000;
    d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0, expirySec: 60, nowMs: t0,
    });
    const n = d.sweepExpired(t0 + 120_000);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(d.summary().expired).toBeGreaterThanOrEqual(1);
  });

  it("summary counts statuses correctly", () => {
    const d = fresh();
    d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0,
    });
    const s = d.summary();
    expect(s.pending).toBeGreaterThanOrEqual(1);
    expect(s.total).toBe(s.pending + s.confirmed + s.refuted + s.expired);
  });

  it("formatDreamLine summarises with status icon", () => {
    const d = fresh();
    d.runCycle({
      axioms: [
        { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
        { axiomId: "a2", body: "hmac signatures must include version prefix" },
      ],
      pairThreshold: 0.1, noveltyThreshold: 0.0,
    });
    const c = d.pendingReview()[0]!;
    expect(formatDreamLine(c)).toContain("DREAM");
    expect(formatDreamLine(c)).toContain("💤");
  });

  it("deterministic — same axiom pool produces same candidateIds", () => {
    const d1 = fresh(); const d2 = fresh();
    const axioms = [
      { axiomId: "a1", body: "hmac signatures must be compared with timingSafeEqual" },
      { axiomId: "a2", body: "hmac signatures must include version prefix" },
    ];
    const r1 = d1.runCycle({ axioms, pairThreshold: 0.1, noveltyThreshold: 0.0 });
    const r2 = d2.runCycle({ axioms, pairThreshold: 0.1, noveltyThreshold: 0.0 });
    expect(r1.candidates[0]!.candidateId).toBe(r2.candidates[0]!.candidateId);
  });
});

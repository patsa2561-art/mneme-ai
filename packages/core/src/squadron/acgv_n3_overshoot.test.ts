/**
 * v2.19.46 — N3-OVERSHOOT 6-VECTOR REGRESSION TEST PINNED FOREVER.
 *
 *   User dogfood audit (v2.19.42) reported 6 specific claim shapes
 *   that the verify CLI mishandled because the vaccine cache fired
 *   on the canonical "mneme.X.Y is registered" shape regardless of
 *   whether the tool was actually in the catalog.
 *
 *   The fix shipped in v2.19.44 (vaccine match path now re-verifies
 *   catalog before AUTO_REFUTE). This test PINS the exact 6-vector
 *   matrix the user described so the bug class cannot ship again.
 *
 *   USER'S TEST MATRIX (verbatim from audit):
 *
 *     "mneme.truth.forensic is registered"           → TRUSTWORTHY ✓
 *     "mneme.truth.forensic exists"                  → TRUSTWORTHY ✓
 *     "mneme.truth.forensic is a real tool"          → TRUSTWORTHY ✓
 *     "the tool mneme.truth.forensic is registered"  → TRUSTWORTHY ✓
 *     "Mneme has tool mneme.truth.forensic"          → TRUSTWORTHY ✓
 *     "mneme.fake.tool is registered"                → REFUTED ✓ (genuine lie)
 *
 *   Each vector exercises a different layer of the cache-vs-truth
 *   invariant. If ANY vector regresses, this test fails CI and the
 *   v2.19.44 fix has been silently undone.
 */

import { describe, it, expect } from "vitest";
import { runACGVAsync } from "./acgv.js";
import { explain } from "./acgv_explain.js";
import { forensicVerify } from "../truth_forensic_pipeline/index.js";

// A pretend catalog where mneme.truth.forensic IS registered and
// mneme.fake.tool is NOT. This is the realistic catalog state at
// any v2.19.34+ install (truth.forensic shipped in v2.19.15).
const CATALOG_WITH_TRUTH_FORENSIC = [
  "mneme.truth.forensic",
  "mneme.truth.contradictions",
  "mneme.welcome",
  "mneme.capabilities",
  "mneme.governor.govern",
];

interface VectorResult {
  acgvVerdict: string;
  forensicVerdict: string;
  finalTrafficLight: string;
  finalHeadline: string;
}

async function runVerifyPipeline(claim: string, catalog: string[]): Promise<VectorResult> {
  const acgv = await runACGVAsync({ claim, repoRoot: process.cwd(), noEmitVaccine: true });
  const explained = explain(acgv, claim);
  const forensic = forensicVerify({ claim, groundTruth: { mcpCatalog: catalog } });

  // Simulate the verify CLI mutation path so the test mirrors what
  // the user actually sees on `mneme verify "..."`.
  const acgvWeak = acgv.verdict === "PASSTHROUGH" || acgv.verdict === "LIMBO";
  let finalTrafficLight = explained.trafficLight;
  let finalHeadline = explained.headline;
  if (forensic.verdict === "REJECTED") {
    finalHeadline = "FORENSIC-REJECTED";
    finalTrafficLight = "red";
  } else if (forensic.verdict === "ACCEPTED" && acgvWeak) {
    const sup = forensic.assertions.filter((a) => a.sub_verdict === "supported").length;
    finalHeadline = `FORENSIC-ACCEPTED — ${sup}/${forensic.assertions.length}`;
    finalTrafficLight = "green";
  }

  return {
    acgvVerdict: acgv.verdict,
    forensicVerdict: forensic.verdict,
    finalTrafficLight,
    finalHeadline,
  };
}

describe("v2.19.46 N3-OVERSHOOT 6-VECTOR REGRESSION (user audit verbatim)", () => {
  it("vector 1: 'mneme.truth.forensic is registered' — must NOT be IMPOSSIBLE_REFUTE (the original bug)", async () => {
    const r = await runVerifyPipeline("mneme.truth.forensic is registered", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.acgvVerdict).not.toBe("IMPOSSIBLE_REFUTE");
    expect(r.acgvVerdict).not.toBe("AUTO_REFUTE");
    expect(r.finalTrafficLight).toBe("green");
    expect(r.finalHeadline).toContain("FORENSIC-ACCEPTED");
  }, 30_000);

  it("vector 2: 'mneme.truth.forensic exists' — TRUSTWORTHY via forensic", async () => {
    const r = await runVerifyPipeline("mneme.truth.forensic exists", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.forensicVerdict).toBe("ACCEPTED");
    expect(r.finalTrafficLight).toBe("green");
  }, 30_000);

  it("vector 3: 'mneme.truth.forensic is a real tool' — TRUSTWORTHY via forensic", async () => {
    const r = await runVerifyPipeline("mneme.truth.forensic is a real tool", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.forensicVerdict).toBe("ACCEPTED");
    expect(r.finalTrafficLight).toBe("green");
  }, 30_000);

  it("vector 4: 'the tool mneme.truth.forensic is registered' (prefix-shielded) — TRUSTWORTHY", async () => {
    const r = await runVerifyPipeline("the tool mneme.truth.forensic is registered", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.forensicVerdict).toBe("ACCEPTED");
    expect(r.finalTrafficLight).toBe("green");
  }, 30_000);

  it("vector 5: 'Mneme has tool mneme.truth.forensic' — TRUSTWORTHY", async () => {
    const r = await runVerifyPipeline("Mneme has tool mneme.truth.forensic", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.forensicVerdict).toBe("ACCEPTED");
    expect(r.finalTrafficLight).toBe("green");
  }, 30_000);

  it("vector 6: 'mneme.fake.tool is registered' — REFUTED (genuine lie, MUST stay refuted)", async () => {
    const r = await runVerifyPipeline("mneme.fake.tool is registered", CATALOG_WITH_TRUTH_FORENSIC);
    expect(r.forensicVerdict).toBe("REJECTED");
    expect(r.finalTrafficLight).toBe("red");
    expect(r.finalHeadline).toContain("FORENSIC-REJECTED");
  }, 30_000);

  it("cross-vector invariant: NO TRUE claim returns AUTO_REFUTE / IMPOSSIBLE_REFUTE", async () => {
    const trueClaims = [
      "mneme.truth.forensic is registered",
      "mneme.truth.forensic exists",
      "mneme.truth.forensic is a real tool",
      "the tool mneme.truth.forensic is registered",
      "Mneme has tool mneme.truth.forensic",
    ];
    for (const claim of trueClaims) {
      const r = await runACGVAsync({ claim, repoRoot: process.cwd(), noEmitVaccine: true });
      expect(r.verdict, `claim "${claim}" must not auto-refute when tool IS in catalog`).not.toBe("AUTO_REFUTE");
      expect(r.verdict, `claim "${claim}" must not impossible-refute when tool IS in catalog`).not.toBe("IMPOSSIBLE_REFUTE");
    }
  }, 60_000);

  it("cross-vector invariant: genuine lies for fake tools STILL get REJECTED", async () => {
    const fakeClaims = [
      "mneme.fake.tool is registered",
      "mneme.absolutely.imaginary is registered",
      "mneme.zzz999.never_existed is registered",
    ];
    for (const claim of fakeClaims) {
      const forensic = forensicVerify({ claim, groundTruth: { mcpCatalog: CATALOG_WITH_TRUTH_FORENSIC } });
      expect(forensic.verdict, `claim "${claim}" must be REJECTED (tool not in catalog)`).toBe("REJECTED");
    }
  }, 60_000);
});

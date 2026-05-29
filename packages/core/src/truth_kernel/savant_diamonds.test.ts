/**
 * v2.90.0 — 💎 the four remaining savant diamonds.
 *
 *   ② SYMBIOSIS   — extractClaims / repairDraft (FALSE→correct, UNKNOWN→flag, TRUE→keep, prose untouched)
 *   ③ COMPOUNDING — consolidate ACTIVE truths → axioms; contested subjects quarantined; idempotent + signed
 *   ④ PUBLIC GAUNTLET — pinned corpus passes (0/0/100/100) + signed report verifies offline; tamper caught
 *   ⑤ TRUTH MESH  — export signed bundle; merge verifies sigs (forged dropped, claim-swap dropped),
 *                   surfaces conflicts, idempotent
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaims, isCheckableClaim, repairDraft, symbioticVerify } from "./symbiosis.js";
import { compoundLattice } from "./compound.js";
import { runPublicGauntlet, verifyGauntletReport, PUBLIC_GAUNTLET_CORPUS } from "./gauntlet_public.js";
import { exportTruths, mergeTruths } from "./truth_mesh.js";
import { assertClaim } from "./aletheia.js";

function repo(): string { return mkdtempSync(join(tmpdir(), "diamonds-")); }
const T = 1_700_000_000_000;

describe("v2.90.0 💎② SAVANT SYMBIOSIS", () => {
  it("S1 isCheckableClaim / extractClaims — checkable vs prose", () => {
    expect(isCheckableClaim("2+2=5")).toBe(true);
    expect(isCheckableClaim("React 19 ships RSC by default")).toBe(true);
    expect(isCheckableClaim("What should we do next?")).toBe(false); // question
    expect(isCheckableClaim("Let's think carefully")).toBe(false);   // vibe
    const claims = extractClaims("Let's begin. The value is 2+2=5. Nice work everyone.");
    expect(claims).toContain("The value is 2+2=5.");
    expect(claims.some((c) => c.includes("Nice work"))).toBe(false);
  });

  it("S2 repairDraft — FALSE corrected, UNKNOWN flagged, TRUE & prose kept", async () => {
    const r = await repairDraft(repo(), "Intro sentence. 2+2=5. 10*10=100. The 9000th visitor tomorrow wears red.", { issuedAt: T });
    expect(r.changed).toBe(true);
    expect(r.falseCount).toBe(1);
    expect(r.unknownCount).toBe(1);
    expect(r.trueCount).toBe(1);
    expect(r.repaired).toMatch(/✗ savant: FALSE/);   // the 2+2=5 got a correction marker
    expect(r.repaired).toMatch(/UNVERIFIED/);          // the unprovable got flagged
    expect(r.repaired).toContain("Intro sentence.");   // prose untouched
  });

  it("S3 symbioticVerify single-claim hook never throws + 3-valued", async () => {
    const v = await symbioticVerify(repo(), "2+2=5", { issuedAt: T });
    expect(v.verdict).toBe("FALSE");
    expect(["TRUE", "FALSE", "UNKNOWN"]).toContain((await symbioticVerify(repo(), "   ", { issuedAt: T })).verdict);
  });
});

describe("v2.90.0 💎③ IDLE COMPOUNDING", () => {
  it("C1 consolidates corroborating truths → crystallised axiom; idempotent; signed", async () => {
    const r = repo();
    await assertClaim(r, "2+2=4", { record: true, issuedAt: T });
    await assertClaim(r, "2+2=4", { record: true, issuedAt: T, sensors: [{ id: "x", weight: 2, run: () => ({ sensor: "x", verdict: "TRUE", confidence: 1 }) }] });
    const c1 = compoundLattice(r, { issuedAt: T });
    expect(c1.axioms.length).toBe(1);
    expect(c1.axioms[0]!.support).toBe(2);
    expect(c1.axioms[0]!.crystallised).toBe(true);
    expect(c1.receipt).not.toBeNull();
    // idempotent: re-running yields the same axiom set
    const c2 = compoundLattice(r, { issuedAt: T });
    expect(c2.axioms.length).toBe(c1.axioms.length);
    expect(c2.crystallisedCount).toBe(c1.crystallisedCount);
  });

  it("C2 contested subject (conflicting active verdicts) is quarantined, NOT an axiom", async () => {
    const r = repo();
    await assertClaim(r, "the widget is enabled", { record: true, issuedAt: T, sensors: [{ id: "t", weight: 2, run: () => ({ sensor: "t", verdict: "TRUE", confidence: 1 }) }] });
    await assertClaim(r, "the widget is enabled", { record: true, issuedAt: T, sensors: [{ id: "f", weight: 2, run: () => ({ sensor: "f", verdict: "FALSE", confidence: 1 }) }] });
    const c = compoundLattice(r, { issuedAt: T });
    expect(c.contested.length).toBe(1);
    expect(c.axioms.find((a) => a.subject === c.contested[0]!.subject)).toBeUndefined();
  });
});

describe("v2.90.0 💎④ PUBLIC SAVANT GAUNTLET", () => {
  it("G1 the pinned corpus passes (false-assert 0 / forget 0 / provable 1 / abstain 1) + signed", async () => {
    const g = await runPublicGauntlet(repo(), { issuedAt: T });
    expect(g.corpusSize).toBe(PUBLIC_GAUNTLET_CORPUS.length);
    expect(g.falseAssertionRate).toBe(0);
    expect(g.forgetRate).toBe(0);
    expect(g.provability).toBe(1);
    expect(g.abstentionRate).toBe(1);
    expect(g.passed).toBe(true);
    expect(g.receipt).not.toBeNull();
  });

  it("G2 the signed report verifies offline; a tampered report is caught", async () => {
    const g = await runPublicGauntlet(repo(), { issuedAt: T });
    const v = verifyGauntletReport(g.receipt);
    expect(v.valid).toBe(true);
    expect(v.passed).toBe(true);
    // forge the pass flag → signature breaks
    const forged = JSON.parse(JSON.stringify(g.receipt));
    forged.payload.passed = true; forged.payload.falseAssertionRate = 0.5;
    expect(verifyGauntletReport(forged).valid).toBe(false);
    expect(verifyGauntletReport(null).valid).toBe(false);
  });
});

describe("v2.90.0 💎⑤ CROSS-AGENT TRUTH MESH", () => {
  it("M1 export → merge adds verified truths; idempotent re-merge adds nothing", async () => {
    const a = repo(), b = repo();
    await assertClaim(a, "2+2=4", { record: true, issuedAt: T });
    await assertClaim(a, "10*10=100", { record: true, issuedAt: T });
    const bundle = exportTruths(a, "agentA", { issuedAt: T });
    expect(bundle.truths.length).toBe(2);
    expect(bundle.receipt).not.toBeNull();
    const m1 = mergeTruths(b, bundle, { issuedAt: T });
    expect(m1.added).toBe(2);
    expect(m1.bundleVerified).toBe(true);
    const m2 = mergeTruths(b, bundle, { issuedAt: T }); // idempotent
    expect(m2.added).toBe(0);
    expect(m2.duplicate).toBe(2);
  });

  it("M2 forgery defense — unsigned + claim-swapped truths are DROPPED", async () => {
    const a = repo(), dest = repo();
    await assertClaim(a, "2+2=4", { record: true, issuedAt: T });
    const bundle = exportTruths(a, "agentA", { issuedAt: T });
    // (a) strip the per-truth signature → must be rejected
    const unsigned = JSON.parse(JSON.stringify(bundle));
    unsigned.truths[0].receipt = null;
    expect(mergeTruths(repo(), unsigned, { issuedAt: T }).rejectedUnsigned).toBe(1);
    // (b) swap the claim text but keep the (now-mismatched) valid signature → rejected
    const swapped = JSON.parse(JSON.stringify(bundle));
    swapped.truths[0].claim = "2+2=999";
    const ms = mergeTruths(dest, swapped, { issuedAt: T });
    expect(ms.rejectedUnsigned).toBe(1);
    expect(ms.added).toBe(0);
  });

  it("M3 conflicts are SURFACED, not silently merged", async () => {
    const a = repo(), dest = repo();
    // dest already holds "x is red" TRUE
    await assertClaim(dest, "x is red", { record: true, issuedAt: T, sensors: [{ id: "t", weight: 2, run: () => ({ sensor: "t", verdict: "TRUE", confidence: 1 }) }] });
    // peer A exports "x is red" FALSE
    await assertClaim(a, "x is red", { record: true, issuedAt: T, sensors: [{ id: "f", weight: 2, run: () => ({ sensor: "f", verdict: "FALSE", confidence: 1 }) }] });
    const bundle = exportTruths(a, "agentA", { issuedAt: T });
    const m = mergeTruths(dest, bundle, { issuedAt: T });
    expect(m.conflicts.length).toBe(1);
    expect(m.added).toBe(0); // the conflicting truth was NOT merged
  });
});

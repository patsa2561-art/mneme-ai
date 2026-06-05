import { describe, it, expect } from "vitest";
import { buildReckoning, reckoningGauntlet, type Evidence } from "./index.js";

const clean: Evidence = { subject: "c1", attested: true, attestVerified: true, secretsClean: true, engagement: "ALLOW", cosigned: false, customsClean: true, reverted: false };

describe("RECKONING — the signed accountability dossier (the record as a shield)", () => {
  it("clean + verified + in-policy → EXONERATED", () => {
    const r = buildReckoning(clean);
    expect(r.verdict).toBe("EXONERATED");
    expect(r.exoneratedBy.length).toBeGreaterThan(0);
  });
  it("a signed violation → ACCOUNTABLE + names it", () => {
    expect(buildReckoning({ ...clean, secretsClean: false }).verdict).toBe("ACCOUNTABLE");
    expect(buildReckoning({ ...clean, engagement: "NEEDS_COSIGN", cosigned: false }).verdict).toBe("ACCOUNTABLE");
    expect(buildReckoning({ ...clean, attestVerified: false }).verdict).toBe("ACCOUNTABLE");
    expect(buildReckoning({ ...clean, secretsClean: false }).accountableFor[0]).toContain("secret");
  });
  it("a cosign clears a sensitive action", () => {
    expect(buildReckoning({ ...clean, engagement: "NEEDS_COSIGN", cosigned: true }).verdict).toBe("EXONERATED");
  });
  it("no signed record → INSUFFICIENT (never guesses)", () => {
    expect(buildReckoning({ ...clean, attested: false, attestVerified: false }).verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("being reverted is a note, not misconduct", () => {
    const r = buildReckoning({ ...clean, reverted: true });
    expect(r.verdict).toBe("EXONERATED");
    expect(r.findings.some((f) => f.severity === "note")).toBe(true);
  });
  it("total on garbage", () => {
    expect(() => buildReckoning(null as never)).not.toThrow();
  });
  it("MEASURED: reckoningGauntlet = 100", () => {
    const g = reckoningGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});

import { describe, it, expect } from "vitest";
import {
  assessRisk, issueCertificate, verifyCertificate, decideClaim,
  tierPremiumUsd, formatOracleLine,
} from "./index.js";

describe("v2.18 · MNEME ORACLE", () => {
  describe("assessRisk", () => {
    it("BLOCK SOUL forces very_high regardless of other inputs", () => {
      const r = assessRisk({ description: "x", soulVerdict: "BLOCK", bugProphetRisk: 0.05 });
      expect(r.band).toBe("very_high");
      expect(r.insurable).toBe(false);
    });

    it("PASS SOUL + low prophet + good aurelian = very_low / low", () => {
      const r = assessRisk({
        description: "tiny doc fix",
        soulVerdict: "PASS",
        bugProphetRisk: 0.05,
        aurelianComposite: 90,
      });
      expect(r.insurable).toBe(true);
      expect(["very_low", "low"]).toContain(r.band);
    });

    it("WARN SOUL adds 0.10", () => {
      const a = assessRisk({ description: "x", soulVerdict: "PASS", bugProphetRisk: 0.20 });
      const b = assessRisk({ description: "x", soulVerdict: "WARN", bugProphetRisk: 0.20 });
      expect(b.riskScore).toBeGreaterThan(a.riskScore);
    });

    it("financial category multiplies risk 1.6×", () => {
      const a = assessRisk({ description: "x", bugProphetRisk: 0.30, soulVerdict: "PASS", category: "code" });
      const b = assessRisk({ description: "x", bugProphetRisk: 0.30, soulVerdict: "PASS", category: "financial" });
      expect(b.riskScore).toBeGreaterThan(a.riskScore);
    });

    it("vendor falseRateLB > 0.1 increases risk", () => {
      const a = assessRisk({ description: "x", bugProphetRisk: 0.10, soulVerdict: "PASS", vendorFalseRateLB: 0.05 });
      const b = assessRisk({ description: "x", bugProphetRisk: 0.10, soulVerdict: "PASS", vendorFalseRateLB: 0.30 });
      expect(b.riskScore).toBeGreaterThan(a.riskScore);
    });

    it("missing prophet defaults to skeptical 0.5", () => {
      const r = assessRisk({ description: "x" });
      expect(r.riskScore).toBeGreaterThanOrEqual(0.45);
    });

    it("riskScore is clamped to (0, 1)", () => {
      const r = assessRisk({ description: "x", soulVerdict: "BLOCK", bugProphetRisk: 0.99, vendorFalseRateLB: 0.99, category: "financial" });
      expect(r.riskScore).toBeLessThanOrEqual(0.99);
      expect(r.riskScore).toBeGreaterThan(0);
    });
  });

  describe("issueCertificate", () => {
    it("issues a starter cert for low-risk change", () => {
      const r = issueCertificate({
        subscriber: "acme-corp",
        tier: "starter",
        change: { description: "doc tweak", soulVerdict: "PASS", bugProphetRisk: 0.05, aurelianComposite: 90 },
      });
      expect(r.issued).not.toBeNull();
      expect(r.issued!.tier).toBe("starter");
      expect(r.issued!.perIncidentCapUsd).toBe(1_000);
      expect(r.issued!.annualAggregateCapUsd).toBe(10_000);
      expect(r.issued!.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(r.issued!.certId).toMatch(/^lc-[0-9a-f]{14}$/);
    });

    it("refuses to issue when not insurable (BLOCK SOUL)", () => {
      const r = issueCertificate({
        subscriber: "acme-corp",
        tier: "team",
        change: { description: "yolo prod migration", soulVerdict: "BLOCK", bugProphetRisk: 0.6 },
      });
      expect(r.issued).toBeNull();
      expect(r.reason).toContain("not insurable");
    });

    it("refuses to issue when risk >= 0.50", () => {
      const r = issueCertificate({
        subscriber: "x",
        tier: "starter",
        change: { description: "x", soulVerdict: "WARN", bugProphetRisk: 0.55 },
      });
      expect(r.issued).toBeNull();
    });

    it("enterprise tier has $1M per-incident / $10M aggregate", () => {
      const r = issueCertificate({
        subscriber: "bigco",
        tier: "enterprise",
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05, aurelianComposite: 90 },
      });
      expect(r.issued!.perIncidentCapUsd).toBe(1_000_000);
      expect(r.issued!.annualAggregateCapUsd).toBe(10_000_000);
    });

    it("attaches 5+ conditions to the cert", () => {
      const r = issueCertificate({
        subscriber: "x", tier: "starter",
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05 },
      });
      expect(r.issued!.conditions.length).toBeGreaterThanOrEqual(5);
      expect(r.issued!.conditions.some((c) => c.includes("PROJECT SOUL"))).toBe(true);
    });
  });

  describe("verifyCertificate", () => {
    it("verifies a clean cert", () => {
      const r = issueCertificate({
        subscriber: "x", tier: "starter",
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05 },
      });
      const v = verifyCertificate(r.issued!);
      expect(v.ok).toBe(true);
    });

    it("rejects tampered cert", () => {
      const r = issueCertificate({
        subscriber: "x", tier: "starter",
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05 },
      });
      const tampered = { ...r.issued!, perIncidentCapUsd: 1_000_000_000 };
      const v = verifyCertificate(tampered);
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("sig mismatch");
    });

    it("rejects expired cert", () => {
      const issuedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const r = issueCertificate({
        subscriber: "x", tier: "starter", issuedAt,
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05 },
      });
      const v = verifyCertificate(r.issued!);
      expect(v.expired).toBe(true);
      expect(v.ok).toBe(false);
    });
  });

  describe("decideClaim", () => {
    function freshCert() {
      return issueCertificate({
        subscriber: "acme", tier: "team",
        change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05, aurelianComposite: 90 },
      }).issued!;
    }

    it("approves a small claim under cap", () => {
      const cert = freshCert();
      const d = decideClaim({ cert, estimatedLossUsd: 500, incidentDescription: "minor bug" });
      expect(d.decision).toBe("approved");
      expect(d.payoutUsd).toBe(500);
      expect(d.sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("partial when loss exceeds per-incident cap", () => {
      const cert = freshCert(); // team: $10k per incident
      const d = decideClaim({ cert, estimatedLossUsd: 50_000, incidentDescription: "big bug" });
      expect(d.decision).toBe("partial");
      expect(d.payoutUsd).toBe(10_000);
    });

    it("denied when aggregate cap exhausted", () => {
      const cert = freshCert();
      const d = decideClaim({
        cert, estimatedLossUsd: 1000, incidentDescription: "x",
        aggregatePaidYtdUsd: cert.annualAggregateCapUsd, // already paid out the whole year
      });
      expect(d.decision).toBe("denied");
      expect(d.payoutUsd).toBe(0);
    });

    it("denied when conditions breached", () => {
      const cert = freshCert();
      const d = decideClaim({
        cert, estimatedLossUsd: 500, incidentDescription: "x",
        conditionsBreached: ["vendor swap mid-policy"],
      });
      expect(d.decision).toBe("denied");
      expect(d.payoutUsd).toBe(0);
    });

    it("denied when cert sig is invalid", () => {
      const cert = freshCert();
      const tampered = { ...cert, perIncidentCapUsd: cert.perIncidentCapUsd * 1000 };
      const d = decideClaim({ cert: tampered, estimatedLossUsd: 500, incidentDescription: "x" });
      expect(d.decision).toBe("denied");
    });
  });

  it("tierPremiumUsd ladder is monotone", () => {
    expect(tierPremiumUsd("sovereign")).toBeGreaterThan(tierPremiumUsd("enterprise"));
    expect(tierPremiumUsd("enterprise")).toBeGreaterThan(tierPremiumUsd("business"));
    expect(tierPremiumUsd("business")).toBeGreaterThan(tierPremiumUsd("team"));
    expect(tierPremiumUsd("team")).toBeGreaterThan(tierPremiumUsd("starter"));
  });

  it("formatOracleLine summarises", () => {
    const r = issueCertificate({
      subscriber: "acme", tier: "team",
      change: { description: "x", soulVerdict: "PASS", bugProphetRisk: 0.05 },
    });
    const line = formatOracleLine(r.issued!);
    expect(line).toContain("ORACLE");
    expect(line).toContain("acme");
    expect(line).toContain("team");
  });
});

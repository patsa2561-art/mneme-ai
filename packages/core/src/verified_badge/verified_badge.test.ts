import { describe, it, expect } from "vitest";
import { issueBadge, verifyBadge, badgeSvg, determineTier, tierAnnualLicense, formatBadgeLine } from "./index.js";

describe("v2.18 · MNEME VERIFIED BADGE", () => {
  describe("determineTier", () => {
    it("PLATINUM: <2% falseRate + 5000+ verdicts", () => {
      expect(determineTier(0.01, 6000)).toBe("platinum");
    });
    it("GOLD: <5% + 1000+", () => {
      expect(determineTier(0.04, 1500)).toBe("gold");
    });
    it("SILVER: <10% + 200+", () => {
      expect(determineTier(0.08, 250)).toBe("silver");
    });
    it("BRONZE: <20% + 50+", () => {
      expect(determineTier(0.15, 60)).toBe("bronze");
    });
    it("FAIL: too few samples even with low rate", () => {
      expect(determineTier(0.01, 10)).toBe("fail");
    });
    it("FAIL: too high rate even with many samples", () => {
      expect(determineTier(0.30, 10000)).toBe("fail");
    });
  });

  describe("issue + verify", () => {
    it("issues a GOLD badge", () => {
      const b = issueBadge({ vendor: "claude", displayName: "Claude", falseRateLB: 0.04, totalVerdicts: 1500 });
      expect(b.tier).toBe("gold");
      expect(b.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(b.certId).toMatch(/^[0-9a-f]{12}$/);
    });

    it("verifies a clean badge", () => {
      const b = issueBadge({ vendor: "x", displayName: "X", falseRateLB: 0.02, totalVerdicts: 100 });
      const r = verifyBadge(b);
      // SILVER (under 10%, >= 200 needed) — actually 100 < 200 → BRONZE? No, 100 < 50? no >= 50 → BRONZE
      // 0.02 < 0.20 ✓ + 100 >= 50 ✓ → BRONZE
      expect(b.tier).toBe("bronze");
      expect(r.ok).toBe(true);
    });

    it("rejects tampered badge", () => {
      const b = issueBadge({ vendor: "claude", displayName: "Claude", falseRateLB: 0.04, totalVerdicts: 1500 });
      const tampered = { ...b, displayName: "EVIL TWIN" };
      const r = verifyBadge(tampered);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("sig mismatch");
    });

    it("rejects expired badge", () => {
      const issuedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      const b = issueBadge({ vendor: "x", displayName: "X", falseRateLB: 0.02, totalVerdicts: 1500, issuedAt });
      const r = verifyBadge(b);
      expect(r.expired).toBe(true);
      expect(r.ok).toBe(false);
    });

    it("rejects FAIL tier badges (cannot display)", () => {
      const b = issueBadge({ vendor: "x", displayName: "X", falseRateLB: 0.5, totalVerdicts: 10 });
      expect(b.tier).toBe("fail");
      const r = verifyBadge(b);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("tier=fail");
    });
  });

  describe("badgeSvg", () => {
    it("returns valid SVG with vendor name + tier + certId", () => {
      const b = issueBadge({ vendor: "claude", displayName: "Anthropic Claude", falseRateLB: 0.01, totalVerdicts: 6000 });
      const svg = badgeSvg(b);
      expect(svg).toContain("<svg");
      expect(svg).toContain("Anthropic Claude");
      expect(svg).toContain("PLATINUM");
      expect(svg).toContain(b.certId);
    });

    it("escapes vendor name to prevent SVG injection", () => {
      const b = issueBadge({ vendor: "x", displayName: "<script>alert(1)</script>", falseRateLB: 0.01, totalVerdicts: 6000 });
      const svg = badgeSvg(b);
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&lt;script&gt;");
    });
  });

  it("tierAnnualLicense returns sensible USD values", () => {
    expect(tierAnnualLicense("platinum")).toBeGreaterThan(tierAnnualLicense("gold"));
    expect(tierAnnualLicense("gold")).toBeGreaterThan(tierAnnualLicense("silver"));
    expect(tierAnnualLicense("fail")).toBe(0);
  });

  it("formatBadgeLine summarises", () => {
    const b = issueBadge({ vendor: "claude", displayName: "Claude", falseRateLB: 0.04, totalVerdicts: 1500 });
    expect(formatBadgeLine(b)).toContain("BADGE");
    expect(formatBadgeLine(b)).toContain("gold");
  });
});

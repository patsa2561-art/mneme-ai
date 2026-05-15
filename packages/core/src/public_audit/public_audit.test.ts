import { describe, it, expect } from "vitest";
import { audit, formatPublicAuditLine } from "./index.js";

describe("v2.16 · MNEME AURELIAN PUBLIC AUDIT", () => {
  it("platinum verdict for popular + fresh + permissive + typed package", () => {
    const r = audit({
      registry: "npm", packageName: "react",
      metadata: {
        version: "18.3.0",
        weeklyDownloads: 25_000_000,
        stars: 220_000,
        license: "MIT",
        hasTypes: true, hasReadme: true,
        homepage: "https://react.dev",
        lastPublished: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(r.composite).toBeGreaterThanOrEqual(85);
    expect(["platinum", "gold"]).toContain(r.verdict);
  });

  it("needs_work for stale + unlicensed + no-readme package", () => {
    const r = audit({
      registry: "npm", packageName: "obscure-broken-thing",
      metadata: {
        weeklyDownloads: 5,
        stars: 1,
        license: undefined,
        hasTypes: false, hasReadme: false,
        lastPublished: new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(r.verdict).toBe("needs_work");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it("recommends adding types when missing", () => {
    const r = audit({
      registry: "npm", packageName: "x",
      metadata: { weeklyDownloads: 100, hasReadme: true, license: "MIT", hasTypes: false, lastPublished: new Date().toISOString() },
    });
    expect(r.recommendations.some((s) => /TypeScript types/i.test(s))).toBe(true);
  });

  it("flags copyleft licenses as 'restrictive for commercial'", () => {
    const r = audit({
      registry: "npm", packageName: "x",
      metadata: { weeklyDownloads: 100, license: "GPL-3.0", hasReadme: true, hasTypes: true, lastPublished: new Date().toISOString() },
    });
    expect(r.evidence.some((e) => /copyleft|restrictive/i.test(e))).toBe(true);
  });

  it("HMAC sig is 64 hex", () => {
    const r = audit({ registry: "npm", packageName: "x", metadata: {} });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("freshness scoring is monotonic with age", () => {
    const day = 24 * 60 * 60 * 1000;
    const recent = audit({ registry: "npm", packageName: "a", metadata: { lastPublished: new Date(Date.now() - 10 * day).toISOString(), license: "MIT", hasReadme: true, hasTypes: true, weeklyDownloads: 1000 } });
    const old = audit({ registry: "npm", packageName: "b", metadata: { lastPublished: new Date(Date.now() - 400 * day).toISOString(), license: "MIT", hasReadme: true, hasTypes: true, weeklyDownloads: 1000 } });
    expect(recent.scores.freshness).toBeGreaterThan(old.scores.freshness);
  });

  it("formatPublicAuditLine summarises", () => {
    const r = audit({ registry: "npm", packageName: "react", metadata: { weeklyDownloads: 25_000_000, license: "MIT", hasTypes: true, hasReadme: true, lastPublished: new Date().toISOString() } });
    expect(formatPublicAuditLine(r)).toContain("AUDIT");
    expect(formatPublicAuditLine(r)).toContain("/100");
  });
});

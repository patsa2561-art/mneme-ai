/**
 * v2.19.86 — Honesty Certificate deep tests.
 * Pins the load-bearing invariants of the cert mint + verify + SVG round-trip.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeHonestyScore, mintCert, verifyCert, verifyCertSvg, renderCertSvg, listCerts,
} from "./index.js";

function tmpRepo() { return mkdtempSync(join(tmpdir(), "mneme-cert-")); }

const SAMPLE_AGG = {
  byColor: { green: 0, yellow: 0, red: 0, grey: 0 },
  byVendor: {
    "claude-ai": { total: 150, green: 130, yellow: 10, red: 8, grey: 2 },
    "small-sample": { total: 5, green: 5, yellow: 0, red: 0, grey: 0 },
    "noisy": { total: 80, green: 30, yellow: 25, red: 25, grey: 0 },
  },
  windowHours: 720,
};

describe("honesty_cert · score + tier", () => {
  it("computes honesty rate excluding grey from denominator", () => {
    const s = computeHonestyScore(SAMPLE_AGG, "claude-ai");
    // judged = 130+10+8 = 148; green/judged = 130/148 ≈ 0.878.
    expect(s.sampleSize).toBe(148);
    expect(s.rawHonestyPct).toBeCloseTo(0.878, 2);
    expect(s.wilsonLowerBound).toBeGreaterThan(0.80);
    expect(s.wilsonLowerBound).toBeLessThan(0.91);
  });

  it("under-sampled vendor with 100% honesty gets BRONZE (not platinum)", () => {
    const s = computeHonestyScore(SAMPLE_AGG, "small-sample");
    expect(s.rawHonestyPct).toBe(1);
    // Wilson 95% LB on 5/5 is ~0.57 — under the platinum threshold even
    // though raw rate is 100%. Tier should reflect the sample-size guard.
    expect(s.band).not.toBe("platinum");
  });

  it("unknown vendor returns zero-sample needs-work", () => {
    const s = computeHonestyScore(SAMPLE_AGG, "no-such-vendor");
    expect(s.sampleSize).toBe(0);
    expect(s.band).toBe("needs-work");
  });
});

describe("honesty_cert · mint + verify round-trip", () => {
  it("mint then verify is VALID", () => {
    const r = tmpRepo();
    try {
      const score = computeHonestyScore(SAMPLE_AGG, "claude-ai");
      const cert = mintCert(r, score);
      const result = verifyCert(r, cert);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("ok");
      expect(result.expiresInDays).toBeGreaterThan(28);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("tampered cert fails verify (bad-sig)", () => {
    const r = tmpRepo();
    try {
      const cert = mintCert(r, computeHonestyScore(SAMPLE_AGG, "claude-ai"));
      const tampered = { ...cert, honestyPct: 0.99 }; // forged
      const result = verifyCert(r, tampered);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("bad-sig");
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("expired cert fails verify (expired)", async () => {
    const r = tmpRepo();
    try {
      const cert = mintCert(r, computeHonestyScore(SAMPLE_AGG, "claude-ai"), { validDays: 30 });
      const expired = mintCert(r, computeHonestyScore(SAMPLE_AGG, "claude-ai"), { validDays: 0 });
      // Wait long enough that validUntil ≈ mintedAt has passed.
      await new Promise<void>((res) => setTimeout(res, 100));
      const result = verifyCert(r, expired);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("expired");
      // The sibling non-expired cert is still valid.
      expect(verifyCert(r, cert).valid).toBe(true);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

describe("honesty_cert · SVG round-trip", () => {
  it("renderCertSvg embeds the cert as data-cert", () => {
    const r = tmpRepo();
    try {
      const cert = mintCert(r, computeHonestyScore(SAMPLE_AGG, "claude-ai"));
      const svg = renderCertSvg(cert);
      expect(svg).toContain("data-cert=");
      expect(svg).toContain("claude-ai");
      expect(svg.startsWith("<svg")).toBe(true);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("verifyCertSvg extracts payload + re-verifies HMAC", () => {
    const r = tmpRepo();
    try {
      const cert = mintCert(r, computeHonestyScore(SAMPLE_AGG, "claude-ai"));
      const svg = renderCertSvg(cert);
      const result = verifyCertSvg(r, svg);
      expect(result.valid).toBe(true);
      expect(result.cert?.certId).toBe(cert.certId);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("malformed SVG fails verify (malformed)", () => {
    const r = tmpRepo();
    try {
      const result = verifyCertSvg(r, "<svg>no data-cert attr</svg>");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("malformed");
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

describe("honesty_cert · listCerts", () => {
  it("returns newest-first list of every minted cert", () => {
    const r = tmpRepo();
    try {
      const s1 = computeHonestyScore(SAMPLE_AGG, "claude-ai");
      const s2 = computeHonestyScore(SAMPLE_AGG, "noisy");
      const c1 = mintCert(r, s1);
      const c2 = mintCert(r, s2);
      const list = listCerts(r);
      expect(list.length).toBe(2);
      expect(list[0]!.certId).toBe(c2.certId);
      expect(list[1]!.certId).toBe(c1.certId);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

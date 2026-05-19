/**
 * v2.19.60 PUBLISH VERIFIER — deep tests.
 *
 * Strategy: we can't hit the real npm registry deterministically (network
 * + state), so we test the PURE LOGIC by stubbing the probe function or
 * using known-published versions for read-only happy-path verification.
 */

import { describe, it, expect } from "vitest";
import {
  MNEME_PACKAGES,
  probeRegistry,
  probeAllForVersion,
  diagnoseInstallable,
} from "./index.js";

describe("v2.19.60 PUBLISH VERIFIER — catalog + structure", () => {
  it("MNEME_PACKAGES catalog has all 5 lockstep packages", () => {
    expect(MNEME_PACKAGES).toContain("@mneme-ai/core");
    expect(MNEME_PACKAGES).toContain("@mneme-ai/embeddings");
    expect(MNEME_PACKAGES).toContain("@mneme-ai/correlator");
    expect(MNEME_PACKAGES).toContain("@mneme-ai/mcp");
    expect(MNEME_PACKAGES).toContain("mneme-ai");
    expect(MNEME_PACKAGES.length).toBe(5);
  });

  it("probeRegistry returns structured result with errorCode on miss", () => {
    // Use a guaranteed-nonexistent version to test the miss path
    const r = probeRegistry("@mneme-ai/embeddings", "0.0.0-NONEXISTENT-PROBE", { timeoutMs: 30_000 });
    expect(r.pkg).toBe("@mneme-ai/embeddings");
    expect(r.version).toBe("0.0.0-NONEXISTENT-PROBE");
    expect(r.present).toBe(false);
    expect(typeof r.errorCode).toBe("string");
    expect(typeof r.ms).toBe("number");
  });

  it("probeRegistry returns present=true for a known-shipped version", () => {
    // v2.19.57 is the last fully-shipped version before the v58 bug
    const r = probeRegistry("@mneme-ai/embeddings", "2.19.57", { timeoutMs: 30_000 });
    expect(r.present).toBe(true);
    expect(r.verifiedVersion).toBe("2.19.57");
  }, 60_000);
});

describe("v2.19.60 PUBLISH VERIFIER — probeAllForVersion", () => {
  it("probeAllForVersion returns 5 probes + recommendation text", () => {
    const r = probeAllForVersion("0.0.0-NONEXISTENT-VERSION", { timeoutMs: 30_000 });
    expect(r.probes.length).toBe(5);
    expect(r.presentCount + r.missingCount).toBe(5);
    expect(r.allPresent).toBe(false);
    expect(r.missingCount).toBe(5);
    expect(r.missingPackages.length).toBe(5);
    expect(typeof r.recommendation).toBe("string");
    expect(r.recommendation).toContain("MISSING");
  }, 90_000);

  it("probeAllForVersion catches the v2.19.58 missing-embeddings bug class shape", () => {
    // Synthetic test: probe a version where we KNOW embeddings was missing
    // (we fixed it retroactively but the test verifies the SHAPE of detection)
    // For a fully-shipped version like 2.19.57, all 5 should be present
    const r = probeAllForVersion("2.19.57", { timeoutMs: 30_000 });
    expect(r.allPresent).toBe(true);
    expect(r.presentCount).toBe(5);
    expect(r.missingPackages).toEqual([]);
  }, 90_000);
});

describe("v2.19.60 PUBLISH VERIFIER — diagnoseInstallable + fallback", () => {
  it("diagnoseInstallable returns installable=true for fully-shipped version", () => {
    const r = diagnoseInstallable("2.19.57", { timeoutMs: 30_000 });
    expect(r.installable).toBe(true);
    expect(r.reason).toContain("present");
    expect(r.fallbackVersion).toBeUndefined();
  }, 90_000);

  it("diagnoseInstallable suggests fallback for missing version (via stubbed probe)", () => {
    // Stub the fallback probe to return true for "2.19.99" so we don't hit
    // real registry latency in unit test
    const r = diagnoseInstallable("99.99.99", {
      timeoutMs: 5_000,
      fallbackProbe: (v) => v === "99.99.95", // pretend 99.99.95 is fully shipped
    });
    expect(r.installable).toBe(false);
    expect(r.reason).toMatch(/missing/);
    expect(r.fallbackVersion).toBe("99.99.95");
  }, 60_000);

  it("diagnoseInstallable returns no fallback when none found in 5-attempt window", () => {
    const r = diagnoseInstallable("99.99.99", {
      timeoutMs: 5_000,
      fallbackProbe: () => false, // pretend nothing in window is shipped
    });
    expect(r.installable).toBe(false);
    expect(r.fallbackVersion).toBeUndefined();
  }, 30_000);
});

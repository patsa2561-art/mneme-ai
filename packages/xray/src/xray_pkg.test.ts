import { describe, it, expect } from "vitest";
import { xrayGauntlet } from "./gauntlet.js";
import { xrayLeaksRaw } from "./privacy.js";
import { isAllowedPublicUrl } from "./clone.js";
import { buildXRay } from "./engine.js";
import { sealXRay, verifyXRay } from "./sign.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("@mneme-ai/xray", () => {
  it("gauntlet is 100 (privacy moat invariants hold)", () => {
    expect(xrayGauntlet().score).toBe(100);
  });

  it("xrayLeaksRaw is total + fail-closed on garbage", () => {
    expect(() => xrayLeaksRaw(null)).not.toThrow();
    expect(xrayLeaksRaw(null).leaks).toBe(true);
    expect(xrayLeaksRaw(undefined).leaks).toBe(true);
  });

  it("rejects non-public / credentialed git URLs, accepts clean public ones", () => {
    expect(isAllowedPublicUrl("https://github.com/sindresorhus/slugify")).toBe(true);
    expect(isAllowedPublicUrl("https://gitlab.com/a/b.git")).toBe(true);
    expect(isAllowedPublicUrl("https://github.com/u:tok@evil/x")).toBe(false);
    expect(isAllowedPublicUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedPublicUrl("https://example.com/x/y")).toBe(false);
  });

  it("builds a real, accurate, raw-free, signable X-Ray of THIS repo (dogfood)", async () => {
    const report = await buildXRay({ repoPath: repoRoot });
    // accuracy: real git facts (this repo has commits + a single dominant author)
    expect(report.age.totalCommits).toBeGreaterThan(0);
    expect(report.age.lifespanDays).toBeGreaterThan(0); // proves the age-from-git fix (not 0)
    expect(report.busFactor.authors).toBeGreaterThan(0);
    expect(report.summary.signalsRun).toBeGreaterThanOrEqual(4);
    // privacy: the emitted report must be raw-free
    expect(xrayLeaksRaw(report).leaks).toBe(false);
    // signed + offline-verifiable
    const signed = sealXRay(repoRoot, report);
    expect(verifyXRay(signed).valid).toBe(true);
  }, 120_000);
});

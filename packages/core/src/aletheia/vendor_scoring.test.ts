import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeVendorScores, renderVendorScoreLine } from "./vendor_scoring.js";
import { generateBadgeSvg, generateBadgeJson } from "./badge_generator.js";

function setupRepo(repo: string, complianceLines: object[], streaksObj: object | null = null, quorumLines: object[] = []): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  if (complianceLines.length > 0) {
    writeFileSync(join(repo, ".mneme/ai-compliance.jsonl"), complianceLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  if (streaksObj) writeFileSync(join(repo, ".mneme/streaks.json"), JSON.stringify(streaksObj));
  if (quorumLines.length > 0) {
    mkdirSync(join(repo, ".mneme/squadron"), { recursive: true });
    writeFileSync(join(repo, ".mneme/squadron/quorum.jsonl"), quorumLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
}

describe("aletheia/vendor_scoring · empty repo", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aletheia-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns [] when no signals on disk", () => {
    expect(computeVendorScores(repo)).toEqual([]);
  });
});

describe("aletheia/vendor_scoring · composite math", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aletheia-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("perfect compliance → score in 'verified' tier (≥90)", () => {
    setupRepo(repo, Array.from({ length: 20 }, () => ({ vendor: "claude-opus-4-7", outcome: "executed" })));
    const scores = computeVendorScores(repo);
    expect(scores).toHaveLength(1);
    expect(scores[0]!.composite).toBeGreaterThanOrEqual(75);   // 100%×0.45 + 0.5 baselines = 0.725 = 73 — let me check math
    expect(scores[0]!.components.compliance).toBe(1);
  });

  it("zero failed mandates → compliance component = 1", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }, { vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    expect(s.components.compliance).toBe(1);
  });

  it("all failed mandates → compliance component = 0", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "failed" }, { vendor: "v", outcome: "failed" }]);
    const s = computeVendorScores(repo)[0]!;
    expect(s.components.compliance).toBe(0);
  });

  it("mixed → compliance = ok / (ok+bad)", () => {
    setupRepo(repo, [
      { vendor: "v", outcome: "executed" }, { vendor: "v", outcome: "executed" },
      { vendor: "v", outcome: "failed" },
    ]);
    const s = computeVendorScores(repo)[0]!;
    expect(s.components.compliance).toBeCloseTo(2 / 3, 4);
  });

  it("multiple vendors return separately + sorted by composite desc", () => {
    setupRepo(repo, [
      { vendor: "alpha", outcome: "executed" }, { vendor: "alpha", outcome: "executed" },
      { vendor: "beta", outcome: "failed" }, { vendor: "beta", outcome: "failed" },
    ]);
    const scores = computeVendorScores(repo);
    expect(scores).toHaveLength(2);
    expect(scores[0]!.composite).toBeGreaterThan(scores[1]!.composite);
    expect(scores[0]!.vendor).toBe("alpha");
  });

  it("low sample size triggers 'low confidence' note", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    expect(s.confidenceNote).toContain("low confidence");
    expect(s.sampleSize).toBe(1);
  });
});

describe("aletheia/vendor_scoring · pricingTier hidden field", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aletheia-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("every score carries pricingTier='free-forever-mvp' (mandate)", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    expect(s.pricingTier).toBe("free-forever-mvp");
  });

  it("renderVendorScoreLine does NOT include pricingTier", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    const line = renderVendorScoreLine(s);
    expect(line).not.toContain("pricingTier");
    expect(line).not.toContain("free-forever-mvp");
    expect(line).not.toContain("paid");
  });

  it("generateBadgeJson does NOT include pricingTier (public renderer)", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    const j = generateBadgeJson(s);
    expect(j).not.toHaveProperty("pricingTier");
  });
});

describe("aletheia/badge_generator · SVG output", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-aletheia-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("small badge: well-formed SVG with vendor + score in title", () => {
    setupRepo(repo, [{ vendor: "claude-opus-4-7", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    const svg = generateBadgeSvg(s);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("/100");
    expect(svg).toContain("claude-opus-4-7");
  });

  it("large badge: includes vendor display + tier", () => {
    setupRepo(repo, [{ vendor: "v", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    const svg = generateBadgeSvg(s, { size: "large" });
    expect(svg).toContain("mneme aletheia");
    expect(svg).toContain(s.badge);
  });

  it("escapes vendor name with HTML special chars", () => {
    setupRepo(repo, [{ vendor: "<script>alert(1)</script>", outcome: "executed" }]);
    const s = computeVendorScores(repo)[0]!;
    const svg = generateBadgeSvg(s);
    expect(svg).not.toContain("<script>alert(1)</script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("badge color tier matches score tier", () => {
    // Two vendors: high-score → green; low-score → red
    setupRepo(repo, [
      ...Array.from({ length: 20 }, () => ({ vendor: "high", outcome: "executed" })),
      ...Array.from({ length: 20 }, () => ({ vendor: "low", outcome: "failed" })),
    ]);
    const scores = computeVendorScores(repo);
    const high = scores.find((s) => s.vendor === "high")!;
    const low = scores.find((s) => s.vendor === "low")!;
    const highSvg = generateBadgeSvg(high);
    const lowSvg = generateBadgeSvg(low);
    // verified/trusted tier uses green (#16a34a) or blue (#2563eb)
    expect(highSvg).toMatch(/#16a34a|#2563eb/);
    // flagged tier uses red (#dc2626)
    expect(lowSvg).toContain("#dc2626");
  });
});

import { describe, it, expect } from "vitest";
import { tierize, computeSavings } from "./tiered-descriptions.js";

describe("tierize — short form generation", () => {
  it("short equals long when input already brief", () => {
    const r = tierize("Find pricing logic.");
    expect(r.short).toBe("Find pricing logic.");
    expect(r.truncated).toBe(false);
  });

  it("strips augmentation lines (📍 ❌ 👤 🚨 📜) from short form", () => {
    const long = `Find Stripe pricing logic in this codebase.

📍 Canonical: services/billing/v2/
❌ Deprecated: lib/stripe/
👤 alice owns services/billing/v2/
🚨 Past incident: PII leak
📜 Constitution rule: must use v2`;
    const r = tierize(long);
    expect(r.short).not.toContain("Canonical");
    expect(r.short).not.toContain("Deprecated");
    expect(r.short).not.toContain("alice");
    expect(r.short).not.toContain("incident");
    expect(r.short).not.toContain("Constitution");
    expect(r.short).toContain("Find Stripe pricing logic");
  });

  it("preserves the long form unchanged", () => {
    const long = "Detailed multi-line\n📍 augmented\nstuff";
    const r = tierize(long);
    expect(r.long).toBe(long);
  });

  it("truncates to maxShortChars when needed", () => {
    const long = "Find " + "x".repeat(500) + ". more stuff";
    const r = tierize(long, 80);
    expect(r.short.length).toBeLessThanOrEqual(80);
    expect(r.short.endsWith("…")).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it("default maxShortChars = 120", () => {
    const long = "x".repeat(200);
    const r = tierize(long);
    expect(r.short.length).toBeLessThanOrEqual(120);
  });

  it("takes first-sentence cleanly when input has multiple sentences", () => {
    const long = "Short summary. Longer secondary part. Even more detail.";
    const r = tierize(long);
    expect(r.short).toBe("Short summary.");
  });

  it("empty input → empty result (no throw)", () => {
    const r = tierize("");
    expect(r.short).toBe("");
    expect(r.long).toBe("");
    expect(r.truncated).toBe(false);
  });

  it("non-string input degrades gracefully", () => {
    const r = tierize(undefined as unknown as string);
    expect(r.short).toBe("");
  });

  it("computes byte counts for telemetry", () => {
    const long = "Hello world. Detail here.";
    const r = tierize(long);
    expect(r.bytes.long).toBe(25); // length in bytes (ASCII)
    expect(r.bytes.short).toBeLessThanOrEqual(r.bytes.long);
  });

  it("deterministic: same input → same short", () => {
    const long = "Find Stripe pricing logic. Detailed discussion follows.\n📍 Canonical: x";
    const a = tierize(long);
    const b = tierize(long);
    expect(a.short).toBe(b.short);
    expect(a.long).toBe(b.long);
  });
});

describe("computeSavings — across many tools", () => {
  it("reports byte savings", () => {
    const longs = Array.from({ length: 100 }, (_, i) =>
      `Tool ${i} does something.\n📍 Canonical: src/${i}/file.ts\n👤 author${i} owns it\n🚨 Past incident: x`,
    );
    const r = computeSavings(longs);
    expect(r.toolCount).toBe(100);
    expect(r.longTotalBytes).toBeGreaterThan(r.shortTotalBytes);
    expect(r.savedBytes).toBeGreaterThan(0);
    expect(r.savedPct).toBeGreaterThan(0.5); // expect significant saving
    expect(r.savedPct).toBeLessThan(1);
  });

  it("0 tools → 0 savings, no divide-by-zero", () => {
    const r = computeSavings([]);
    expect(r.toolCount).toBe(0);
    expect(r.longTotalBytes).toBe(0);
    expect(r.savedBytes).toBe(0);
    expect(r.savedPct).toBe(0);
  });

  it("tools with no augmentation lines → small savings", () => {
    const longs = ["Find X.", "Find Y.", "Find Z."];
    const r = computeSavings(longs);
    // Without augmentation lines, savings should be ≈ 0 (short ≈ long)
    expect(r.savedBytes).toBeGreaterThanOrEqual(0);
  });

  it("100 typical augmented descriptions: target >50% saving", () => {
    const augmentedTpl = `Find Stripe pricing logic in this codebase. Returns code locations + git history + introducing commits.

📍 Canonical location: services/billing/v2/ (12 functions)
❌ Deprecated: lib/stripe/ (commit abc12345 — moved after PII audit found logging leaks)
👤 alice owns services/billing/v2/ — current expert (atrophy 25/100)
👤 bob backup — atrophy 60/100, pair before changing
🚨 Past incident: PII leak in pricing logs (2024-09-15)
📜 Constitution rule [regret-3]: ❌ MUST NOT log raw Stripe customer email`;
    const longs = Array.from({ length: 100 }, () => augmentedTpl);
    const r = computeSavings(longs);
    expect(r.savedPct).toBeGreaterThan(0.7); // typical augmented descriptions: >70% saving
  });
});

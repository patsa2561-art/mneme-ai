// v2.31.0 — HGP (Hallucination Genome Project) discrete root tests.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeHgpIdFromSimhash, isValidHgpId, disambiguate,
  recordHallucination, lookup, topN, loadCollapsed, computeSeverity,
  readConsent, setConsent, federationStatus, federatePush, verifyLedger,
  severityForVendor, allVendorsBreakdown, topInWindow,
} from "./index.js";

describe("HGP-ID format", () => {
  it("isValidHgpId accepts canonical form", () => {
    expect(isValidHgpId("HGP-2026-00001")).toBe(true);
    expect(isValidHgpId("HGP-2026-12345")).toBe(true);
    expect(isValidHgpId("HGP-2026-12345-A")).toBe(true);
    expect(isValidHgpId("HGP-2026-12345-AB")).toBe(true);
  });
  it("isValidHgpId rejects malformed", () => {
    expect(isValidHgpId("HGP-26-1")).toBe(false);
    expect(isValidHgpId("CVE-2026-12345")).toBe(false);
    expect(isValidHgpId("HGP-2026-123")).toBe(false);
    expect(isValidHgpId("")).toBe(false);
  });
  it("computeHgpIdFromSimhash is deterministic", () => {
    const sim = "deadbeefdeadbeef";
    const id1 = computeHgpIdFromSimhash(sim, "2026-05-23T00:00:00Z");
    const id2 = computeHgpIdFromSimhash(sim, "2026-05-23T00:00:00Z");
    expect(id1).toBe(id2);
    expect(isValidHgpId(id1)).toBe(true);
  });
  it("computeHgpIdFromSimhash differs per simhash within same year", () => {
    const id1 = computeHgpIdFromSimhash("aaaaaaaaaaaaaaaa", "2026-05-23T00:00:00Z");
    const id2 = computeHgpIdFromSimhash("bbbbbbbbbbbbbbbb", "2026-05-23T00:00:00Z");
    expect(id1).not.toBe(id2);
  });
  it("disambiguate appends A, B, C correctly", () => {
    expect(disambiguate("HGP-2026-00001", 0)).toBe("HGP-2026-00001");
    expect(disambiguate("HGP-2026-00001", 1)).toBe("HGP-2026-00001-A");
    expect(disambiguate("HGP-2026-00001", 2)).toBe("HGP-2026-00001-B");
  });
});

describe("recordHallucination + lookup", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "hgp-test-")); });

  it("records a hallucination + assigns a valid HGP-ID", () => {
    const r = recordHallucination(repo, {
      claim: "useFormStatus accepts a reset option",
      signature: "chandrasekhar:UNKNOWN_API",
      vendor: "claude-opus-4.7",
    });
    expect(isValidHgpId(r.hgpId)).toBe(true);
    expect(r.observeCount).toBe(1);
    expect(r.vendorCounts["claude-opus-4.7"]).toBe(1);
  });

  it("same simhash → same HGP-ID across calls (idempotent identity)", () => {
    const r1 = recordHallucination(repo, {
      claim: "useFormStatus accepts a reset option",
      signature: "chandrasekhar:UNKNOWN_API",
      vendor: "claude",
    });
    const r2 = recordHallucination(repo, {
      claim: "useFormStatus accepts a reset option",
      signature: "chandrasekhar:UNKNOWN_API",
      vendor: "gpt-5",
    });
    expect(r2.hgpId).toBe(r1.hgpId);
    const collapsed = loadCollapsed(repo).get(r1.hgpId)!;
    expect(collapsed.observeCount).toBe(2);
    expect(collapsed.vendorCounts["claude"]).toBe(1);
    expect(collapsed.vendorCounts["gpt-5"]).toBe(1);
  });

  it("different simhash → different HGP-ID", () => {
    const r1 = recordHallucination(repo, {
      claim: "React 19 ships server components by default",
      signature: "x", vendor: "a",
    });
    const r2 = recordHallucination(repo, {
      claim: "asyncio.gather accepts a loop= parameter today",
      signature: "x", vendor: "a",
    });
    expect(r2.hgpId).not.toBe(r1.hgpId);
  });

  it("severity grows with observe count + vendor spread", () => {
    const c = "Vue 4 was released yesterday with major breaking changes";
    let r = recordHallucination(repo, { claim: c, signature: "x", vendor: "a" });
    const sev1 = r.severity;
    for (let i = 0; i < 5; i++) recordHallucination(repo, { claim: c, signature: "x", vendor: "a" });
    recordHallucination(repo, { claim: c, signature: "x", vendor: "b" });
    recordHallucination(repo, { claim: c, signature: "x", vendor: "c" });
    r = lookup(repo, r.hgpId)!;
    expect(r.severity).toBeGreaterThan(sev1);
  });

  it("topN returns highest severity first", () => {
    const A = "Common lie about something useful long sentence here";
    const B = "Rare lie observed only once particular pattern";
    for (let i = 0; i < 5; i++) recordHallucination(repo, { claim: A, signature: "x", vendor: "v" });
    recordHallucination(repo, { claim: B, signature: "x", vendor: "v" });
    const top = topN(repo, 2);
    expect(top.length).toBe(2);
    expect(top[0]!.observeCount).toBeGreaterThanOrEqual(top[1]!.observeCount);
  });

  it("redacts obvious secrets from sample text", () => {
    const r = recordHallucination(repo, {
      claim: "the AWS key AKIAIOSFODNN7EXAMPLE was used to call S3",
      signature: "x", vendor: "v",
    });
    expect(r.sample).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.sample).toContain("<aws-key>");
  });
});

describe("federation consent (default OFF)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "hgp-cons-")); });

  it("default consent is opt-out", () => {
    const c = readConsent(repo);
    expect(c.optIn).toBe(false);
  });

  it("setConsent persists across reads", () => {
    setConsent(repo, true, "https://hgp.ai");
    const c = readConsent(repo);
    expect(c.optIn).toBe(true);
    expect(c.endpoint).toBe("https://hgp.ai");
  });

  it("federationStatus reports localCount + consent", () => {
    recordHallucination(repo, { claim: "x lie sentence pattern abc", signature: "y", vendor: "z" });
    const s = federationStatus(repo);
    expect(s.localCount).toBe(1);
    expect(s.consent.optIn).toBe(false);
  });

  it("federatePush refuses without consent", async () => {
    const r = await federatePush(repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/consent/i);
  });

  it("federatePush refuses with consent but no endpoint", async () => {
    setConsent(repo, true);
    const r = await federatePush(repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/endpoint/i);
  });
});

describe("severity windowing", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "hgp-sev-")); });

  it("severityForVendor counts records in window", () => {
    recordHallucination(repo, { claim: "first lie observed here", signature: "x", vendor: "anthropic" });
    recordHallucination(repo, { claim: "second different lie observed", signature: "x", vendor: "anthropic" });
    recordHallucination(repo, { claim: "third one for openai test", signature: "x", vendor: "openai" });
    const a = severityForVendor(repo, "anthropic", 30);
    expect(a.count).toBe(2);
    expect(a.vendor).toBe("anthropic");
    expect(a.windowDays).toBe(30);
  });

  it("allVendorsBreakdown lists every observed vendor", () => {
    recordHallucination(repo, { claim: "lie 1 sentence long enough", signature: "x", vendor: "anthropic" });
    recordHallucination(repo, { claim: "lie 2 sentence long enough", signature: "x", vendor: "openai" });
    const all = allVendorsBreakdown(repo, 30);
    const vendors = all.map((s) => s.vendor).sort();
    expect(vendors).toContain("anthropic");
    expect(vendors).toContain("openai");
  });

  it("topInWindow returns no record outside window", () => {
    recordHallucination(repo, { claim: "lie in window test sentence", signature: "x", vendor: "v" });
    const recent = topInWindow(repo, 30, 5);
    expect(recent.length).toBe(1);
    // 0-day window: nothing recent enough.
    const none = topInWindow(repo, 0, 5);
    expect(none.length).toBe(0);
  });
});

describe("verifyLedger", () => {
  it("returns ok=true on empty registry", () => {
    const repo = mkdtempSync(join(tmpdir(), "hgp-ver-"));
    const r = verifyLedger(repo);
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(0);
  });
  it("counts well-formed lines + accepts them", () => {
    const repo = mkdtempSync(join(tmpdir(), "hgp-ver2-"));
    recordHallucination(repo, { claim: "first lie ok one two three", signature: "x", vendor: "v" });
    recordHallucination(repo, { claim: "second different shape lie one two", signature: "x", vendor: "v" });
    const r = verifyLedger(repo);
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(2);
  });
});

describe("computeSeverity bounds", () => {
  it("severity is in [0,1]", () => {
    const r = computeSeverity({
      hgpId: "HGP-2026-00001",
      simhash: "x", firstSeen: "x", lastSeen: "x",
      observeCount: 1000,
      vendorCounts: { a: 100, b: 100, c: 100, d: 100, e: 100 },
      signature: "x", sample: "x", severity: 0,
    });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

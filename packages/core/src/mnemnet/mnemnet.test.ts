// v2.33.0 — MNEMNET discrete root tests.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  laplaceSample, noisedCount, makeDeterministicRng,
  readConsent, setConsent, buildEnvelope, persistEnvelope,
  listEnvelopes, verifyEnvelope, aggregatePublicHsc, federatePush,
} from "./index.js";
import type { CourtVerdict } from "../citizen_court/types.js";
import type { DpAggregate } from "./types.js";

function makeRepo(): string { return mkdtempSync(join(tmpdir(), "mnemnet-")); }

function fakeVerdict(primary: string, reveals: string[], winner: string | "ABSTAIN", at = new Date().toISOString()): CourtVerdict {
  return {
    id: "v-" + Math.random().toString(36).slice(2, 10),
    primaryVendor: primary, at,
    promptHash: "p", primaryResponseHash: "r",
    primaryAction: "accepted",
    reveals: reveals.map((vendor) => ({ vendor, responseHash: "x", revealDelayMs: 0 })),
    votedMostTruthful: winner,
    dpEpsilon: 0,
    hmac: "deadbeef".repeat(8),
    seq: 1,
    bodyDigest: "x",
  };
}

describe("DP primitives", () => {
  it("laplaceSample with seed is deterministic", () => {
    const rng1 = makeDeterministicRng("s1");
    const rng2 = makeDeterministicRng("s1");
    const a = laplaceSample(1, rng1);
    const b = laplaceSample(1, rng2);
    expect(a).toBe(b);
  });

  it("noisedCount returns trueCount when ε <= 0", () => {
    expect(noisedCount(42, 0)).toBe(42);
    expect(noisedCount(42, -1)).toBe(42);
  });

  it("noisedCount with epsilon=0.5 stays close to true count on average", () => {
    let sum = 0;
    const N = 200;
    const rng = makeDeterministicRng("avg");
    for (let i = 0; i < N; i++) sum += noisedCount(100, 0.5, rng);
    const mean = sum / N;
    // Within 20% of true count for 200 samples + ε=0.5 (scale=2).
    expect(Math.abs(mean - 100)).toBeLessThan(20);
  });
});

describe("Consent (default OFF)", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  it("default consent is opt-out", () => {
    const c = readConsent(repo);
    expect(c.optIn).toBe(false);
  });

  it("setConsent persists across reads + assigns node id", () => {
    const c = setConsent(repo, true, { endpoint: "https://mnemnet.ai", maxEpsilon: 0.3 });
    expect(c.optIn).toBe(true);
    expect(c.nodeId).toMatch(/^node-/);
    expect(c.maxEpsilon).toBe(0.3);
    const read = readConsent(repo);
    expect(read.endpoint).toBe("https://mnemnet.ai");
  });
});

describe("Envelope build + verify", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); setConsent(repo, true, { maxEpsilon: 0.5 }); });

  it("buildEnvelope with no verdicts → empty perVendor + valid HMAC", () => {
    const env = buildEnvelope(repo, [], { deterministicSeed: "z" });
    expect(env.perVendor.length).toBe(0);
    expect(verifyEnvelope(env).ok).toBe(true);
  });

  it("buildEnvelope adds noise but keeps non-negative counts", () => {
    const verdicts = [
      fakeVerdict("claude", ["gpt"], "claude"),
      fakeVerdict("claude", ["gpt"], "claude"),
      fakeVerdict("claude", ["gpt"], "gpt"),
    ];
    const env = buildEnvelope(repo, verdicts, { epsilon: 0.5, deterministicSeed: "seed-1" });
    expect(env.perVendor.length).toBe(2); // claude + gpt
    for (const v of env.perVendor) {
      expect(v.noisedTruthful).toBeGreaterThanOrEqual(0);
      expect(v.noisedDecisive).toBeGreaterThanOrEqual(0);
    }
    expect(verifyEnvelope(env).ok).toBe(true);
  });

  it("epsilon clamped to consent.maxEpsilon", () => {
    const verdicts = [fakeVerdict("a", ["b"], "a")];
    const env = buildEnvelope(repo, verdicts, { epsilon: 100 });
    expect(env.epsilon).toBeLessThanOrEqual(0.5);
  });

  it("tampered envelope fails verify", () => {
    const env = buildEnvelope(repo, [fakeVerdict("x", ["y"], "x")], { deterministicSeed: "t" });
    const tampered: DpAggregate = { ...env, epsilon: 999 };
    expect(verifyEnvelope(tampered).ok).toBe(false);
  });

  it("persist + list round-trip", () => {
    const env = buildEnvelope(repo, [fakeVerdict("p", ["q"], "p")], { deterministicSeed: "rt" });
    persistEnvelope(repo, env);
    const list = listEnvelopes(repo);
    expect(list.length).toBe(1);
    expect(list[0]!.envelopeId).toBe(env.envelopeId);
  });
});

describe("Public HSC aggregation", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); setConsent(repo, true, { maxEpsilon: 1 }); });

  it("aggregates envelopes from multiple nodes", () => {
    // Two nodes worth: pretend each builds N rounds of verdicts.
    const node1 = buildEnvelope(repo, Array.from({ length: 30 }, () => fakeVerdict("claude", ["gpt"], "claude")), { epsilon: 1, deterministicSeed: "n1" });
    const node2 = buildEnvelope(repo, Array.from({ length: 30 }, () => fakeVerdict("claude", ["gpt"], "claude")), { epsilon: 1, deterministicSeed: "n2" });
    // Spoof second envelope as a different node so contributingNodes=2.
    const node2b = { ...node2, nodeId: "node-other" };
    const hsc = aggregatePublicHsc([node1, node2b]);
    const claude = hsc.rows.find((r) => r.vendor === "claude")!;
    expect(claude.contributingNodes).toBe(2);
    expect(claude.totalDecisive).toBeGreaterThan(0);
    expect(claude.meanNoisedTruthfulRate).toBeGreaterThan(0);
  });

  it("band thresholds: unmeasured when totalDecisive < 25", () => {
    const env = buildEnvelope(repo, Array.from({ length: 3 }, () => fakeVerdict("v", ["w"], "v")), { epsilon: 1, deterministicSeed: "u" });
    const hsc = aggregatePublicHsc([env]);
    const v = hsc.rows.find((r) => r.vendor === "v")!;
    expect(v.band).toBe("⚪ unmeasured");
  });
});

describe("Federation stub", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  it("refuses without consent", async () => {
    const env = buildEnvelope(repo, [], { deterministicSeed: "x" });
    const r = await federatePush(repo, env);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/consent/i);
  });

  it("refuses with consent but no endpoint", async () => {
    setConsent(repo, true);
    const env = buildEnvelope(repo, [], { deterministicSeed: "x" });
    const r = await federatePush(repo, env);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/endpoint/i);
  });

  it("returns stub-success with consent + endpoint", async () => {
    setConsent(repo, true, { endpoint: "https://mnemnet.ai" });
    const env = buildEnvelope(repo, [], { deterministicSeed: "x" });
    const r = await federatePush(repo, env);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/stub|coming/i);
  });
});

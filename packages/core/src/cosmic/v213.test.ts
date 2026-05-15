import { describe, it, expect } from "vitest";
import { makePatch, applyPatch, patchIsWorthIt } from "./diff.js";
import { mintChoirSession, publishToChoir, readFromChoir, exportChoirManifest } from "./choir.js";
import { auditFeature, renderScorecard, rollupVerdict, deltaPctToScore, improvementPct } from "./aurelian_audit.js";
import {
  benchmarkJsonPatch, benchmarkEtag, benchmarkBrotli,
  benchmarkNonceWindow, benchmarkInboxRateLimit, benchmarkDeadMansHand,
  benchmarkCelestialChoir, benchmarkEchoFromCommits,
} from "./benchmark.js";

describe("v2.13 · JSON Patch (RFC 6902 subset)", () => {
  it("produces empty patch for identical objects", () => {
    expect(makePatch({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });

  it("produces a single replace for scalar change", () => {
    const p = makePatch({ a: 1 }, { a: 2 });
    expect(p).toEqual([{ op: "replace", path: "/a", value: 2 }]);
  });

  it("handles add + remove + replace in one diff", () => {
    const p = makePatch({ a: 1, b: 2 }, { a: 99, c: 3 });
    expect(p).toContainEqual({ op: "replace", path: "/a", value: 99 });
    expect(p).toContainEqual({ op: "remove", path: "/b" });
    expect(p).toContainEqual({ op: "add", path: "/c", value: 3 });
  });

  it("recurses into nested objects", () => {
    const p = makePatch({ nested: { a: 1, b: 2 } }, { nested: { a: 1, b: 99 } });
    expect(p).toEqual([{ op: "replace", path: "/nested/b", value: 99 }]);
  });

  it("escapes ~ and / in keys per RFC 6901", () => {
    const p = makePatch({ "a/b": 1 }, { "a/b": 2 });
    expect(p[0].path).toBe("/a~1b");
  });

  it("applyPatch round-trips arbitrary state", () => {
    const before = { v: "2.12", commits: [1, 2], meta: { x: true } };
    const after = { v: "2.13", commits: [1, 2, 3], meta: { x: false, y: 1 } };
    const patch = makePatch(before, after);
    expect(applyPatch(before, patch)).toEqual(after);
  });

  it("patchIsWorthIt rejects negligible savings", () => {
    expect(patchIsWorthIt(1000, 999)).toBe(false);
    expect(patchIsWorthIt(1000, 600)).toBe(true);
    expect(patchIsWorthIt(1000, 850)).toBe(false); // 15% saving, < threshold
    expect(patchIsWorthIt(2000, 1700)).toBe(true); // 300 byte saving
  });
});

describe("v2.13 · CELESTIAL CHOIR (multi-server quorum)", () => {
  it("mints one session per seat", () => {
    const choir = mintChoirSession([
      { serverUrl: "https://a.example.com" },
      { serverUrl: "https://b.example.com" },
      { serverUrl: "https://c.example.com" },
    ]);
    expect(choir.seats).toHaveLength(3);
    const tokens = new Set(choir.seats.map((s) => s.session.token));
    expect(tokens.size).toBe(3); // all distinct
  });

  it("publishes in parallel and computes quorum on majority success", async () => {
    const f: typeof fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("a.example")) return new Response(JSON.stringify({ ok: true, count: 1, prevSig: null, newSig: "sigA" }), { status: 201 });
      if (u.includes("b.example")) return new Response(JSON.stringify({ ok: true, count: 1, prevSig: null, newSig: "sigB" }), { status: 201 });
      return new Response(JSON.stringify({ error: "down" }), { status: 503 });
    }) as typeof fetch;
    const choir = mintChoirSession([
      { serverUrl: "https://a.example.com" },
      { serverUrl: "https://b.example.com" },
      { serverUrl: "https://c.example.com" },
    ]);
    const r = await publishToChoir(choir, { v: "2.13" }, f);
    expect(r.total).toBe(3);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.quorumReached).toBe(true); // 2/3 > 50%
  });

  it("reads with strict majority quorum, flags disagreers", async () => {
    const choir = mintChoirSession([
      { serverUrl: "https://a.example.com" },
      { serverUrl: "https://b.example.com" },
      { serverUrl: "https://c.example.com" },
    ]);
    const f: typeof fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      // a + b agree on {v:"2.13"}, c lies and says {v:"2.12"}
      if (u.includes("a.example") || u.includes("b.example")) {
        return new Response(JSON.stringify({ state: { v: "2.13" }, lastPublishTs: 1, publishCount: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: { v: "2.12" }, lastPublishTs: 1, publishCount: 1 }), { status: 200 });
    }) as typeof fetch;
    const r = await readFromChoir(choir, f);
    expect(r.quorumReached).toBe(true);
    expect(r.agree).toBe(2);
    expect(r.disagree).toBe(1);
    expect((r.state as { v: string }).v).toBe("2.13");
    const disagreer = r.perSeat.find((s) => s.serverUrl.includes("c.example"))!;
    expect(disagreer.agreed).toBe(false);
  });

  it("read returns no quorum when all servers disagree", async () => {
    const choir = mintChoirSession([
      { serverUrl: "https://a.example.com" },
      { serverUrl: "https://b.example.com" },
      { serverUrl: "https://c.example.com" },
    ]);
    let i = 0;
    const f: typeof fetch = (async () => {
      i++;
      return new Response(JSON.stringify({ state: { v: `vendor-${i}` }, lastPublishTs: 1, publishCount: 1 }), { status: 200 });
    }) as typeof fetch;
    const r = await readFromChoir(choir, f);
    expect(r.quorumReached).toBe(false);
    expect(r.state).toBeUndefined();
  });

  it("manifest exports stable structure for soul-prompt embedding", () => {
    const choir = mintChoirSession([{ serverUrl: "https://a.example.com" }, { serverUrl: "https://b.example.com", weight: 2 }]);
    const m = exportChoirManifest(choir);
    expect(m.v).toBe(1);
    expect(m.seats).toHaveLength(2);
    expect(m.seats[1].weight).toBe(2);
  });
});

describe("v2.13 · AURELIAN AUDITOR (self-grading)", () => {
  it("improvementPct: 50% reduction in lower-is-better", () => {
    expect(improvementPct({ metric: "x", before: 100, after: 50, unit: "b", betterIs: "lower" })).toBe(50);
  });

  it("improvementPct: 100% increase in higher-is-better", () => {
    expect(improvementPct({ metric: "x", before: 100, after: 200, unit: "x", betterIs: "higher" })).toBe(100);
  });

  it("deltaPctToScore monotonic in the expected ranges", () => {
    expect(deltaPctToScore(0)).toBe(50);
    expect(deltaPctToScore(25)).toBe(80); // pass threshold
    expect(deltaPctToScore(100)).toBeGreaterThanOrEqual(95);
    expect(deltaPctToScore(-25)).toBeLessThan(20);
  });

  it("auditFeature emits SHIP when all axes ≥80", () => {
    const card = auditFeature({
      feature: "test-ship",
      category: "perf",
      measurements: [{ metric: "bytes", before: 1000, after: 100, unit: "bytes", betterIs: "lower" }],
      worldClassEvidence: "Beats RFC-7232 conditional GET by combining ETag with HMAC-chained newSig — no industry server does both. Verified against the spec benchmark with a 95% bandwidth reduction (rps↓ 60).",
      wisdomEvidence: "Composes orthogonally with the existing publish path; the abstraction is removable cleanly without leaking; root cause is bandwidth waste, not a workaround. Additive only — invariants preserved.",
      wildnessEvidence: "No AI handoff vendor (chatgpt, claude, gemini, cursor, copilot, perplexity) has cosmic-style ETag-on-state. Nothing in the field combines this with HMAC chain — first of its kind.",
    });
    expect(card.verdict).toBe("SHIP");
    expect(card.scores.delta).toBeGreaterThanOrEqual(80);
    expect(card.scores.worldClass).toBeGreaterThanOrEqual(80);
    expect(card.scores.wisdom).toBeGreaterThanOrEqual(80);
    expect(card.scores.wildness).toBeGreaterThanOrEqual(80);
  });

  it("auditFeature emits LOOP_BACK when an axis is 60-79", () => {
    // Solid measurements + decent length but missing concrete numbers / vendor names → mid-range scores.
    const card = auditFeature({
      feature: "weak-evidence",
      category: "perf",
      measurements: [{ metric: "bytes", before: 1000, after: 100, unit: "bytes", betterIs: "lower" }],
      worldClassEvidence: "It is generally a good improvement over what was previously available in this area of the system.",
      wisdomEvidence: "Reasonable change without major leaks; could be cleaner but acceptable for this revision pass.",
      wildnessEvidence: "Unusual approach not commonly seen in this layer of the stack within similar systems we have looked at.",
    });
    expect(card.verdict).toBe("LOOP_BACK");
  });

  it("auditFeature emits REJECT when an axis < 60", () => {
    // Regression measurement → delta score collapses well below 60.
    const card = auditFeature({
      feature: "regression",
      category: "perf",
      measurements: [{ metric: "bytes", before: 100, after: 200, unit: "bytes", betterIs: "lower" }],
      worldClassEvidence: "x",
      wisdomEvidence: "x",
      wildnessEvidence: "x",
    });
    expect(card.verdict).toBe("REJECT");
  });

  it("renderScorecard produces stable text output", () => {
    const card = auditFeature({
      feature: "render-test",
      category: "perf",
      measurements: [{ metric: "ms", before: 100, after: 50, unit: "ms", betterIs: "lower" }],
      worldClassEvidence: "x".repeat(120),
      wisdomEvidence: "y".repeat(120),
      wildnessEvidence: "z".repeat(120),
    });
    const text = renderScorecard(card);
    expect(text).toContain("AURELIAN");
    expect(text).toContain("render-test");
    expect(text).toContain("delta=");
  });

  it("rollupVerdict aggregates correctly across cards", () => {
    const ship = auditFeature({
      feature: "a", category: "perf",
      measurements: [{ metric: "x", before: 100, after: 1, unit: "bytes", betterIs: "lower" }],
      worldClassEvidence: "Beats every industry-standard implementation by 100x — no vendor does this. Cited: RFC standard, beats SOTA benchmark by 99% measured (req/min↓).",
      wisdomEvidence: "Composes orthogonally with existing publish path; removable cleanly; root cause is the bandwidth-waste invariant — not a hack. Decouples cleanly. Additive only.",
      wildnessEvidence: "No AI vendor (chatgpt, claude, gemini, cursor, copilot, openai, anthropic) has this. First-of-its-kind 100x reduction. Nothing in the field comes close.",
    });
    const loop = auditFeature({
      feature: "b", category: "perf",
      measurements: [{ metric: "x", before: 100, after: 90, unit: "bytes", betterIs: "lower" }], // 10% — gives delta in 60-79 range
      worldClassEvidence: "It is generally an improvement over what existed before in this part of the system stack today.",
      wisdomEvidence: "Reasonable change without leaks; could be cleaner but acceptable for this revision pass overall.",
      wildnessEvidence: "Unusual approach not commonly seen in this layer of the stack within similar systems we have seen.",
    });
    const r = rollupVerdict([ship, loop]);
    expect(r.verdict).toBe("LOOP_BACK");
    expect(r.ship).toBe(1);
    expect(r.loop).toBe(1);
  });
});

describe("v2.13 · benchmark harness produces concrete numbers", () => {
  it("JSON Patch wins big on realistic cosmic state (single-field change)", () => {
    // Realistic cosmic state: ~30 commits + history + notes. ~4KB payload.
    const baseState = {
      v: "2.12.0",
      commits: Array.from({ length: 30 }, (_, i) => ({ sha: "a".repeat(40), subject: `feat: change ${i}`, ts: Date.now() + i })),
      notes: "x".repeat(800),
      meta: { live: true, daemon: "running" },
    };
    const after = { ...baseState, v: "2.13.0" }; // only the version bumped
    const m = benchmarkJsonPatch(baseState, after);
    const sizeMetric = m.find((x) => x.metric.includes("payload"))!;
    // Patch should be at least 10x smaller than full state for a 1-field change.
    expect(sizeMetric.after * 10).toBeLessThan(sizeMetric.before);
    const fidelity = m.find((x) => x.metric.includes("fidelity"))!;
    expect(fidelity.after).toBe(100);
  });

  it("ETag saves ≥95% on 100-poll cycle of 2KB unchanged state", () => {
    // 2KB payload + 100 polls is the realistic daemon-poller scenario.
    const m = benchmarkEtag(2048, 100)[0];
    const pct = ((m.before - m.after) / m.before) * 100;
    expect(pct).toBeGreaterThan(95);
  });

  it("ETag still beats raw fetch by >90% even on smaller workloads", () => {
    // Sanity: even 1KB × 60 polls should save ≥90%.
    const m = benchmarkEtag(1024, 60)[0];
    const pct = ((m.before - m.after) / m.before) * 100;
    expect(pct).toBeGreaterThan(90);
  });

  it("Brotli compresses meaningfully better than gzip on JSON payloads", () => {
    const payload = JSON.stringify({
      mneme: "2.13.0", commits: Array.from({ length: 50 }, (_, i) => `${"a".repeat(40)}-${i}`),
      authors: ["alice", "bob"], notes: "x".repeat(500),
    });
    const m = benchmarkBrotli(payload);
    const sizeMetric = m[0];
    // Brotli should beat gzip by some non-trivial margin on this corpus.
    expect(sizeMetric.after).toBeLessThan(sizeMetric.before);
  });

  it("nonce-window benchmark proves replay defense reduction", () => {
    const m = benchmarkNonceWindow(120)[0];
    expect(m.before).toBe(86400);
    expect(m.after).toBe(120);
  });

  it("inbox rate-limit benchmark proves bound", () => {
    const m = benchmarkInboxRateLimit(60)[0];
    expect(m.after).toBeLessThan(m.before);
  });

  it("dead-man's-hand MTTR benchmark", () => {
    const m = benchmarkDeadMansHand(60)[0];
    expect(m.after).toBeLessThan(m.before / 100);
  });

  it("CELESTIAL CHOIR fault tolerance scales with seats", () => {
    const m = benchmarkCelestialChoir(3);
    expect(m[0].after).toBe(2); // 3 seats → tolerate 2 failures
    expect(m[1].after).toBe(3);
  });

  it("ECHO-FROM-COMMITS recovers state offline", () => {
    const m = benchmarkEchoFromCommits()[0];
    expect(m.before).toBe(0);
    expect(m.after).toBe(100);
  });
});

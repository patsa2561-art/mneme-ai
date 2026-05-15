import { describe, it, expect } from "vitest";
import { buildMerkleSummary, diffSummaries, inferCausal, routeFederatedQuery, formatLivingModelLine } from "./index.js";

describe("v2.16 · LIVING MODEL primitives", () => {
  describe("Merkle anti-entropy", () => {
    it("empty observation list still produces a root", () => {
      const s = buildMerkleSummary("host-a", []);
      expect(s.root).toMatch(/^[0-9a-f]{64}$/);
      expect(s.total).toBe(0);
    });

    it("identical observation sets produce identical roots", () => {
      const obs = [{ id: "o1", ts: "x", host: "a", kind: "k", subject: "s" }];
      const a = buildMerkleSummary("h", obs);
      const b = buildMerkleSummary("h", obs);
      expect(a.root).toBe(b.root);
    });

    it("diff finds missing ids both ways", () => {
      const a = buildMerkleSummary("a", [
        { id: "1", ts: "t", host: "a", kind: "k", subject: "s" },
        { id: "2", ts: "t", host: "a", kind: "k", subject: "s" },
      ]);
      const b = buildMerkleSummary("b", [
        { id: "2", ts: "t", host: "b", kind: "k", subject: "s" },
        { id: "3", ts: "t", host: "b", kind: "k", subject: "s" },
      ]);
      const d = diffSummaries(a, b);
      expect(d.toFetch).toEqual(["3"]);
      expect(d.toSend).toEqual(["1"]);
      expect(d.rootsMatch).toBe(false);
    });

    it("identical sets → rootsMatch true + no ids to fetch", () => {
      const obs = [{ id: "x", ts: "t", host: "a", kind: "k", subject: "s" }];
      const a = buildMerkleSummary("a", obs);
      const b = buildMerkleSummary("b", obs);
      const d = diffSummaries(a, b);
      expect(d.rootsMatch).toBe(true);
      expect(d.toFetch).toEqual([]);
      expect(d.toSend).toEqual([]);
    });
  });

  describe("Causal inference", () => {
    it("empty input → zero samples", () => {
      const r = inferCausal([]);
      expect(r.samples).toBe(0);
    });

    it("cause precedes effect → positive directionalityVote + positive mean lead", () => {
      // Pattern: every day, a deploy at 10:00 → an error_spike 5 min later
      const pairs = [];
      for (let i = 0; i < 5; i++) {
        const dayMs = i * 24 * 60 * 60 * 1000;
        const t0 = 1700000000000 + dayMs;
        // Deploy event (no effect bound yet)
        pairs.push({ ts: new Date(t0).toISOString(), cause: "deploy", effect: "X" });
        // Error spike 5 min after deploy
        pairs.push({ ts: new Date(t0 + 5 * 60 * 1000).toISOString(), cause: "Y", effect: "error_spike" });
      }
      // The first pair sets cause="deploy" effect="X". We want to test
      // deploy→error_spike, so re-orient: pass cause-only and effect-only
      // observations.
      const r = inferCausal([
        { ts: new Date(1700000000000).toISOString(), cause: "deploy", effect: "error_spike" }, // anchor
        ...pairs.slice(1).map((p, i) => ({
          ...p,
          cause: p.cause === "deploy" ? "deploy" : "noop",
          effect: p.effect === "error_spike" ? "error_spike" : "noop",
        })),
      ]);
      expect(r.directionalityVote).toBeGreaterThan(0.5);
      expect(r.meanLeadSeconds).toBeGreaterThan(0);
    });

    it("includes correlation when numeric values supplied", () => {
      const pairs = [];
      for (let i = 0; i < 5; i++) {
        pairs.push({ ts: new Date(1700000000000 + i * 60 * 1000).toISOString(), cause: "load", effect: "latency", value: i + 1 });
        pairs.push({ ts: new Date(1700000000000 + i * 60 * 1000 + 30 * 1000).toISOString(), cause: "load", effect: "latency", value: (i + 1) * 2 });
      }
      const r = inferCausal(pairs);
      expect(r.correlation).not.toBeNull();
    });

    it("HMAC sig present on non-empty result", () => {
      const r = inferCausal([{ ts: "2026-01-01T00:00:00Z", cause: "a", effect: "b" }]);
      expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("Federated query routing", () => {
    it("routes by subject match", () => {
      const r = routeFederatedQuery({
        subject: "auth-service",
        peers: [
          { host: "h1", knownSubjects: ["auth-service", "billing"] },
          { host: "h2", knownSubjects: ["frontend"] },
          { host: "h3", knownSubjects: ["payments"] },
        ],
      });
      expect(r.recommendations[0]!.peer).toBe("h1");
      expect(r.fallback).toBe("narrow");
    });

    it("falls back to broadcast when nobody matches", () => {
      const r = routeFederatedQuery({
        subject: "unknown-service",
        peers: [
          { host: "h1", knownSubjects: ["billing"] },
          { host: "h2", knownSubjects: ["frontend"] },
        ],
      });
      expect(r.fallback).toBe("broadcast");
    });

    it("kind match contributes to score", () => {
      const r = routeFederatedQuery({
        subject: "auth",
        kind: "error_spike",
        peers: [
          { host: "with-kind", knownSubjects: ["auth"], knownKinds: ["error_spike"] },
          { host: "without-kind", knownSubjects: ["auth"] },
        ],
      });
      expect(r.recommendations[0]!.peer).toBe("with-kind");
    });
  });

  it("formatLivingModelLine summarises", () => {
    const s = buildMerkleSummary("h1", [{ id: "x", ts: "t", host: "h1", kind: "k", subject: "s" }]);
    expect(formatLivingModelLine(s)).toContain("LIVING");
    expect(formatLivingModelLine(s)).toContain("h1");
  });
});

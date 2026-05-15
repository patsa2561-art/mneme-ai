import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashPattern, recordObservation, verifyObservation,
  lookupLocal, lookupPublic, publishObservation,
  listLocal, formatHiveLine,
} from "./index.js";

describe("v2.15 · MNEME HIVE — pattern-share marketplace", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hive-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  describe("hashPattern", () => {
    it("identical normalized inputs hash identically", () => {
      const a = hashPattern({ problemText: "TypeError: foo is not a function", kind: "type_error" });
      const b = hashPattern({ problemText: "TypeError: foo is not a function", kind: "type_error" });
      expect(a.hash).toBe(b.hash);
    });

    it("different identifiers but same shape hash identically (privacy + clustering)", () => {
      const a = hashPattern({ problemText: "TypeError: myFunc is not a function", kind: "type_error" });
      const b = hashPattern({ problemText: "TypeError: yourFunc is not a function", kind: "type_error" });
      expect(a.hash).toBe(b.hash);
    });

    it("string literals are masked (privacy)", () => {
      const a = hashPattern({ problemText: 'failed to load "myproject.config"', kind: "build_failure" });
      const b = hashPattern({ problemText: 'failed to load "yourproject.config"', kind: "build_failure" });
      expect(a.hash).toBe(b.hash);
    });

    it("numbers are masked", () => {
      const a = hashPattern({ problemText: "request took 4523ms", kind: "perf" });
      const b = hashPattern({ problemText: "request took 9999ms", kind: "perf" });
      expect(a.hash).toBe(b.hash);
    });

    it("different kinds produce different contextHash even if hash matches", () => {
      const a = hashPattern({ problemText: "x", kind: "bug" });
      const b = hashPattern({ problemText: "x", kind: "perf" });
      expect(a.contextHash).not.toBe(b.contextHash);
    });

    it("hash is 64 hex chars", () => {
      const a = hashPattern({ problemText: "x", kind: "bug" });
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.contextHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("recordObservation", () => {
    it("appends an HMAC-signed observation", () => {
      const h = hashPattern({ problemText: "x is null", kind: "bug" });
      const obs = recordObservation({
        hash: h,
        solution: { kind: "edit", filesAffected: 1, linesChanged: 3, label: "added null check" },
        outcome: "good",
        repoDir: dir,
      });
      expect(obs.id).toMatch(/^h-/);
      expect(obs.sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("verifyObservation true for clean entries", () => {
      const h = hashPattern({ problemText: "x", kind: "bug" });
      const o = recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
      expect(verifyObservation(o)).toBe(true);
    });

    it("verifyObservation false on tamper", () => {
      const h = hashPattern({ problemText: "x", kind: "bug" });
      const o = recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
      const tampered = { ...o, outcome: "bad" as const };
      expect(verifyObservation(tampered)).toBe(false);
    });
  });

  describe("lookupLocal", () => {
    it("returns zero for unseen pattern", () => {
      const h = hashPattern({ problemText: "never seen", kind: "bug" });
      const m = lookupLocal(h, { repoDir: dir });
      expect(m.totalObservations).toBe(0);
      expect(m.bestSolution).toBeNull();
    });

    it("aggregates outcomes across observations", () => {
      const h = hashPattern({ problemText: "x", kind: "bug" });
      for (let i = 0; i < 3; i++) recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1, label: "approach A" }, outcome: "good", repoDir: dir });
      recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 5, linesChanged: 50, label: "approach B" }, outcome: "bad", repoDir: dir });
      const m = lookupLocal(h, { repoDir: dir });
      expect(m.totalObservations).toBe(4);
      expect(m.byOutcome.good).toBe(3);
      expect(m.byOutcome.bad).toBe(1);
      expect(m.bestSolution?.label).toBe("approach A");
      expect(m.bestSolution?.confidence).toBe(1);
    });

    it("ranks by good_rate * sample_size (the established small-sample-tiebreaker)", () => {
      const h = hashPattern({ problemText: "y", kind: "bug" });
      // approach A: 2/2 good
      recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1, label: "A" }, outcome: "good", repoDir: dir });
      recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1, label: "A" }, outcome: "good", repoDir: dir });
      // approach B: 5/5 good
      for (let i = 0; i < 5; i++) recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1, label: "B" }, outcome: "good", repoDir: dir });
      const m = lookupLocal(h, { repoDir: dir });
      // Both 100% confidence, but B has more samples → wins
      expect(m.bestSolution?.label).toBe("B");
    });

    it("HMAC sig on the summary is deterministic and 64-hex", () => {
      const h = hashPattern({ problemText: "z", kind: "bug" });
      recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
      const m = lookupLocal(h, { repoDir: dir });
      expect(m.sig).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("public hive (network calls)", () => {
    it("lookupPublic falls back to local when endpoint fails", async () => {
      const failingFetch: typeof fetch = async () => { throw new Error("ENOTFOUND"); };
      const h = hashPattern({ problemText: "n", kind: "bug" });
      recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1, label: "X" }, outcome: "good", repoDir: dir });
      const m = await lookupPublic(h, { fetchOverride: failingFetch, repoDir: dir });
      expect(m.totalObservations).toBe(1); // local fallback engaged
      expect(m.bestSolution?.label).toBe("X");
    });

    it("lookupPublic uses public response when reachable", async () => {
      const h = hashPattern({ problemText: "p", kind: "bug" });
      const fakeFetch: typeof fetch = (async () => new Response(JSON.stringify({
        hash: h.hash,
        totalObservations: 247,
        byOutcome: { good: 200, bad: 30, regression: 17, unknown: 0 },
        bySolutionKind: { edit: 247 },
        bestSolution: { kind: "edit", label: "global best", confidence: 0.9, samplesGood: 200, samplesTotal: 247 },
        signedAt: "2026-05-15T00:00:00Z",
        sig: "0".repeat(64),
      }), { status: 200 })) as typeof fetch;
      const m = await lookupPublic(h, { fetchOverride: fakeFetch, repoDir: dir });
      expect(m.totalObservations).toBe(247);
      expect(m.bestSolution?.label).toBe("global best");
    });

    it("publishObservation handles network failure gracefully", async () => {
      const failingFetch: typeof fetch = async () => { throw new Error("ENOTFOUND"); };
      const h = hashPattern({ problemText: "x", kind: "bug" });
      const o = recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
      const r = await publishObservation(o, { fetchOverride: failingFetch });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("ENOTFOUND");
    });

    it("publishObservation succeeds on 200", async () => {
      const okFetch: typeof fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
      const h = hashPattern({ problemText: "x", kind: "bug" });
      const o = recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
      const r = await publishObservation(o, { fetchOverride: okFetch });
      expect(r.ok).toBe(true);
    });
  });

  it("listLocal returns all observations", () => {
    const h = hashPattern({ problemText: "x", kind: "bug" });
    for (let i = 0; i < 3; i++) recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
    expect(listLocal({ repoDir: dir })).toHaveLength(3);
  });

  it("formatHiveLine summarises", () => {
    const h = hashPattern({ problemText: "x", kind: "bug" });
    recordObservation({ hash: h, solution: { kind: "edit", filesAffected: 1, linesChanged: 1 }, outcome: "good", repoDir: dir });
    const line = formatHiveLine({ repoDir: dir });
    expect(line).toContain("HIVE");
    expect(line).toContain("1 observations");
    expect(line).toContain("1 good");
  });
});

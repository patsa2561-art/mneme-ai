import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProbes, gradeRun, recordRun, readRuns, trendFor, type NemesisRun } from "./nemesis.js";

const KNOWN_GOOD = {
  existingFile: "package.json",
  fakeFile: "this-file-does-not-exist-xyz.ts",
  existingCommit: "abc1234",
  fakeCommit: "0000000",
  realLanguage: "TypeScript",
  wrongLanguage: "Rust",
  actualToolCount: 129,
};

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-nemesis-")); }
function teardown(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.61 Nemesis · probe generation", () => {
  it("generates probes across 5 families", () => {
    const probes = generateProbes("seed1", 10, KNOWN_GOOD);
    const families = new Set(probes.map((p) => p.family));
    expect(families.size).toBeGreaterThanOrEqual(4);
  });

  it("deterministic: same seed -> same probes", () => {
    const a = generateProbes("same", 10, KNOWN_GOOD).map((p) => p.id).join("|");
    const b = generateProbes("same", 10, KNOWN_GOOD).map((p) => p.id).join("|");
    expect(a).toBe(b);
  });

  it("different seeds -> different probe IDs", () => {
    const a = generateProbes("seed-a", 5, KNOWN_GOOD).map((p) => p.id).join("|");
    const b = generateProbes("seed-b", 5, KNOWN_GOOD).map((p) => p.id).join("|");
    expect(a).not.toBe(b);
  });

  it("each probe has expected truth value", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    for (const p of probes) {
      expect(["true", "false"]).toContain(p.expected);
    }
  });
});

describe("v1.61 Nemesis · grade run", () => {
  it("perfect responses -> score 1.0", () => {
    const probes = generateProbes("s", 10, KNOWN_GOOD);
    const responses = probes.map((p) => ({ probeId: p.id, verdict: p.expected }));
    const r = gradeRun(probes, responses);
    expect(r.score).toBe(1);
  });

  it("all-wrong responses -> score 0", () => {
    const probes = generateProbes("s", 10, KNOWN_GOOD);
    const responses = probes.map((p) => ({
      probeId: p.id, verdict: (p.expected === "true" ? "false" : "true") as "true" | "false",
    }));
    const r = gradeRun(probes, responses);
    expect(r.score).toBe(0);
  });

  it("half-right -> score ~0.5", () => {
    const probes = generateProbes("s", 10, KNOWN_GOOD);
    const responses = probes.map((p, i) => ({
      probeId: p.id,
      verdict: (i % 2 === 0 ? p.expected : (p.expected === "true" ? "false" : "true")) as "true" | "false",
    }));
    const r = gradeRun(probes, responses);
    expect(r.score).toBeGreaterThan(0.4);
    expect(r.score).toBeLessThan(0.6);
  });

  it("breakdown captures per-family correctness", () => {
    const probes = generateProbes("s", 10, KNOWN_GOOD);
    const responses = probes.map((p) => ({ probeId: p.id, verdict: p.expected }));
    const r = gradeRun(probes, responses);
    for (const fam of Object.values(r.byFamily)) {
      if (fam.total > 0) expect(fam.correct).toBe(fam.total);
    }
  });

  it("unknown verdicts count as wrong", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    const responses = probes.map((p) => ({ probeId: p.id, verdict: "unknown" as const }));
    const r = gradeRun(probes, responses);
    expect(r.score).toBe(0);
  });
});

describe("v1.61 Nemesis · trend tracking", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("recordRun + readRuns roundtrip", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    const run: NemesisRun = {
      id: "r1", vendor: "claude-opus-4-7",
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      probes, responses: [], score: 0.8,
      byFamily: gradeRun(probes, []).byFamily,
    };
    recordRun(repo, run);
    const all = readRuns(repo);
    expect(all.length).toBe(1);
    expect(all[0]!.vendor).toBe("claude-opus-4-7");
  });

  it("trendFor returns slope=0 with <2 points", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    const run: NemesisRun = {
      id: "r1", vendor: "v", startedAt: "x", finishedAt: "x",
      probes, responses: [], score: 0.5, byFamily: gradeRun(probes, []).byFamily,
    };
    recordRun(repo, run);
    const t = trendFor(repo, "v");
    expect(t.slope).toBe(0);
    expect(t.points.length).toBe(1);
  });

  it("trendFor computes positive slope for improving scores", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    for (const score of [0.3, 0.5, 0.7, 0.9]) {
      recordRun(repo, {
        id: `r${score}`, vendor: "v",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        probes, responses: [], score,
        byFamily: gradeRun(probes, []).byFamily,
      });
    }
    const t = trendFor(repo, "v");
    expect(t.points.length).toBe(4);
    expect(t.slope).toBeGreaterThan(0);
  });

  it("trendFor filters by vendor", () => {
    const probes = generateProbes("s", 5, KNOWN_GOOD);
    recordRun(repo, { id: "a", vendor: "v1", startedAt: "x", finishedAt: "x", probes, responses: [], score: 0.5, byFamily: gradeRun(probes, []).byFamily });
    recordRun(repo, { id: "b", vendor: "v2", startedAt: "x", finishedAt: "x", probes, responses: [], score: 0.7, byFamily: gradeRun(probes, []).byFamily });
    expect(trendFor(repo, "v1").points.length).toBe(1);
    expect(trendFor(repo, "v2").points.length).toBe(1);
  });
});

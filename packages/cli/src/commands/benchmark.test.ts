/**
 * benchmark — unit tests for the deterministic scoring layer.
 *
 * We don't test the end-to-end retrieve.ask integration here — that
 * touches embedders + LLMs and is covered elsewhere. We DO test the
 * rubric-checking + leaderboard rendering, since those are the
 * scoring fairness guarantees.
 */

import { describe, it, expect } from "vitest";
import {
  _PROBES_FOR_TESTS,
  _checkRubricForTests,
  _renderMarkdownLeaderboardForTests,
} from "./benchmark.js";

describe("benchmark — probe set sanity", () => {
  it("ships exactly 24 probes across 6 categories", () => {
    expect(_PROBES_FOR_TESTS.length).toBe(24);
    const cats = new Set(_PROBES_FOR_TESTS.map((p) => p.category));
    expect(cats.size).toBe(6);
  });

  it("every probe has at least 1 rubric", () => {
    for (const p of _PROBES_FOR_TESTS) {
      expect(p.rubric.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every probe id is unique", () => {
    const ids = new Set(_PROBES_FOR_TESTS.map((p) => p.id));
    expect(ids.size).toBe(_PROBES_FOR_TESTS.length);
  });

  it("category coverage is balanced (≥3 probes per category)", () => {
    const counts = new Map<string, number>();
    for (const p of _PROBES_FOR_TESTS) {
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    for (const [cat, n] of counts) {
      expect(n, `category ${cat} has only ${n} probe(s)`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("benchmark — rubric checking", () => {
  it("must_match: passes when ANY pattern matches", () => {
    const r = _checkRubricForTests(
      { id: "t", description: "", must_match: [/\bcat\b/i, /\bdog\b/i] },
      "I love my CAT very much",
    );
    expect(r).toBe(true);
  });

  it("must_match: fails when no pattern matches", () => {
    const r = _checkRubricForTests(
      { id: "t", description: "", must_match: [/\bcat\b/i, /\bdog\b/i] },
      "I love programming",
    );
    expect(r).toBe(false);
  });

  it("must_not_match: fails when ANY pattern matches", () => {
    const r = _checkRubricForTests(
      { id: "t", description: "", must_not_match: [/\bbad\b/i] },
      "this is a BAD thing",
    );
    expect(r).toBe(false);
  });

  it("combines must_match + must_not_match correctly", () => {
    // Has the "good" word, doesn't have the "bad" word → pass
    const r1 = _checkRubricForTests(
      { id: "t", description: "", must_match: [/\bgood\b/i], must_not_match: [/\bbad\b/i] },
      "this is GOOD",
    );
    expect(r1).toBe(true);
    // Has both → fails
    const r2 = _checkRubricForTests(
      { id: "t", description: "", must_match: [/\bgood\b/i], must_not_match: [/\bbad\b/i] },
      "this is GOOD but also bad",
    );
    expect(r2).toBe(false);
  });

  it("uh-01 rubric rejects a fabricated answer about the fake hash", () => {
    const probe = _PROBES_FOR_TESTS.find((p) => p.id === "uh-01")!;
    const fabricated = "Commit deadbeef… was authored by Alice and introduced a caching layer.";
    expect(_checkRubricForTests(probe.rubric[0]!, fabricated)).toBe(false);
    const honest = "I cannot find that commit hash — it does not exist in this repo.";
    expect(_checkRubricForTests(probe.rubric[0]!, honest)).toBe(true);
  });
});

describe("benchmark — markdown leaderboard rendering", () => {
  it("renders a header + leaderboard table + per-target details", () => {
    const md = _renderMarkdownLeaderboardForTests([
      {
        target: "mneme-self",
        ranAt: "2026-05-08T12:00:00Z",
        totalProbes: 24,
        totalRubricChecks: 30,
        passedRubricChecks: 27,
        scoreByCategory: {
          "factual-recall": { passed: 4, total: 4, pct: 1 },
          "causal-explanation": { passed: 6, total: 8, pct: 0.75 },
          "lineage-trace": { passed: 4, total: 4, pct: 1 },
          "regression-prediction": { passed: 5, total: 6, pct: 0.833 },
          "cited-rationale": { passed: 4, total: 4, pct: 1 },
          "uncertainty-honesty": { passed: 4, total: 4, pct: 1 },
        },
        overallScore: 0.9,
        probeResults: [],
      },
    ]);
    expect(md).toContain("# Mneme — AI Memory Benchmark");
    expect(md).toContain("Lighthouse-of-AI-memory");
    expect(md).toContain("90.0%");
    expect(md).toContain("## Methodology");
    expect(md).toContain("vendor-neutral");
  });

  it("sorts the leaderboard by overall score descending", () => {
    const md = _renderMarkdownLeaderboardForTests([
      {
        target: "lower",
        ranAt: "x",
        totalProbes: 1,
        totalRubricChecks: 1,
        passedRubricChecks: 0,
        scoreByCategory: {},
        overallScore: 0.3,
        probeResults: [],
      },
      {
        target: "higher",
        ranAt: "x",
        totalProbes: 1,
        totalRubricChecks: 1,
        passedRubricChecks: 1,
        scoreByCategory: {},
        overallScore: 0.9,
        probeResults: [],
      },
    ]);
    const idxHigher = md.indexOf("**higher**");
    const idxLower = md.indexOf("**lower**");
    expect(idxHigher).toBeGreaterThan(0);
    expect(idxLower).toBeGreaterThan(0);
    expect(idxHigher).toBeLessThan(idxLower);
  });
});

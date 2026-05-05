/**
 * Property-based test suite — invariants that should hold for ANY input.
 *
 * Total: 10 properties × 10,000 random inputs = 100,000 generated cases per
 * `npm test` run. Same approach as Haskell QuickCheck / Rust proptest.
 *
 * Why this beats hand-written tests at this scale:
 *   - Hand-written: tests one specific case at a time. 100k of them = months
 *     of work + maintenance hell + nobody reads them.
 *   - Property-based: states an invariant ONCE; fast-check generates 10k
 *     pathological inputs (empty strings, NaN, gigantic arrays, unicode
 *     boundaries) we'd never think to write. Failures shrink to minimal repro.
 *
 * Each property below targets ONE invariant of ONE pure function.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { retrieve, insights, util } from "@mneme-ai/core";

const RUNS = 10_000;

// ─── 1. cosine — symmetric, bounded, self-similar ──────────────────────

const arbVec = (size: number) =>
  fc
    .array(fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }), {
      minLength: size,
      maxLength: size,
    })
    .map((arr) => Float32Array.from(arr));

describe("property: cosine — vector dot-product invariants", () => {
  it("symmetric: cosine(a, b) === cosine(b, a)", () => {
    fc.assert(
      fc.property(arbVec(8), arbVec(8), (a, b) => {
        expect(Math.abs(retrieve.cosine(a, b) - retrieve.cosine(b, a))).toBeLessThan(1e-5);
      }),
      { numRuns: RUNS },
    );
  });

  it("bounded: cosine ∈ [-1, 1]", () => {
    fc.assert(
      fc.property(arbVec(8), arbVec(8), (a, b) => {
        const c = retrieve.cosine(a, b);
        expect(c).toBeGreaterThanOrEqual(-1.001);
        expect(c).toBeLessThanOrEqual(1.001);
      }),
      { numRuns: RUNS },
    );
  });

  it("self-similar: cosine(a, a) ≈ 1 for non-zero a", () => {
    fc.assert(
      fc.property(
        arbVec(8).filter((v) => Array.from(v).some((x) => x !== 0)),
        (a) => {
          expect(retrieve.cosine(a, a)).toBeCloseTo(1, 4);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ─── 2. redact — idempotency + completeness ─────────────────────────────

const arbSecretText = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.constantFrom(
    `commit AKIA${"X".repeat(16)} embedded`,
    `oauth ${"gh" + "p_" + "X".repeat(40)} hidden`,
    `stripe ${"sk" + "_live_" + "X".repeat(24)} found`,
    "no secret here at all",
    "",
  ),
);

describe("property: redact — idempotent + leaves no raw secret", () => {
  it("idempotent: redact(redact(x)) === redact(x)", () => {
    fc.assert(
      fc.property(arbSecretText, (text) => {
        const r1 = util.redact(text);
        const r2 = util.redact(r1.text);
        expect(r2.text).toBe(r1.text);
      }),
      { numRuns: RUNS },
    );
  });

  it("no AWS access key id pattern survives redaction", () => {
    fc.assert(
      fc.property(arbSecretText, (text) => {
        const r = util.redact(text);
        expect(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/.test(r.text)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it("no GitHub PAT pattern survives redaction", () => {
    fc.assert(
      fc.property(arbSecretText, (text) => {
        const r = util.redact(text);
        expect(/\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(r.text)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 3. parseStackTrace — total function ───────────────────────────────

describe("property: parseStackTrace — never throws, sane fields", () => {
  it("returns array of frames with valid line numbers", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const frames = insights.parseStackTrace(text);
        expect(Array.isArray(frames)).toBe(true);
        for (const f of frames) {
          expect(typeof f.file).toBe("string");
          expect(Number.isFinite(f.line)).toBe(true);
          expect(f.line).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 4. parseDiff — total + structural invariants ──────────────────────

describe("property: parseDiff — total + bounded counts + valid shape", () => {
  const VALID_SHAPES = ["feat", "fix", "refactor", "test", "docs", "chore", "perf"];
  it("never throws, counts ≥ 0, shape ∈ valid set", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const d = insights.parseDiff(text);
        expect(Array.isArray(d.files)).toBe(true);
        expect(Array.isArray(d.modules)).toBe(true);
        expect(d.added).toBeGreaterThanOrEqual(0);
        expect(d.removed).toBeGreaterThanOrEqual(0);
        expect(VALID_SHAPES).toContain(d.shape);
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 5. classifyIntent — returns valid label, never throws ─────────────

describe("property: classifyIntent — total function returning valid label", () => {
  const VALID = ["specific", "lookup", "temporal", "vague"] as const;
  it("always returns one of {specific, lookup, temporal, vague}", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (q) => {
        const r = retrieve.classifyIntent(q);
        expect(VALID).toContain(r.intent);
        expect(typeof r.reason).toBe("string");
        expect(r.reason.length).toBeGreaterThan(0);
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 6. classifyConfidence — returns valid label ───────────────────────

describe("property: classifyConfidence — valid label for any input", () => {
  const VALID = ["high", "medium", "low", "none"] as const;
  it("always returns one of {high, medium, low, none}", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: Math.fround(0.1), noNaN: true }), {
          minLength: 0,
          maxLength: 20,
        }),
        (scores) => {
          const results = scores
            .sort((a, b) => b - a)
            .map((s, i) => ({
              commit: {
                hash: `h${i}`.padEnd(40, "0"),
                shortHash: `h${i}`.padEnd(7, "0"),
                authorName: "x",
                authorEmail: "x@x",
                authorDate: "2024-01-01T00:00:00Z",
                committerDate: "2024-01-01T00:00:00Z",
                subject: "s",
                body: "",
                parents: [],
                files: [],
              },
              score: s,
              matchedChunks: [],
            }));
          const c = retrieve.classifyConfidence(results);
          expect(VALID).toContain(c);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ─── 7. similarity (crystal-ball) — symmetric, bounded, reflexive ─────

const arbFp = () =>
  fc.record({
    modules: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 5 }),
    extensions: fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 4 }),
    shape: fc.constantFrom("feat", "fix", "refactor", "test", "docs", "chore", "perf"),
    size: fc.constantFrom("tiny", "small", "medium", "large"),
    hasTests: fc.boolean(),
  }) as fc.Arbitrary<Parameters<typeof insights.similarity>[0]>;

describe("property: similarity — symmetric, bounded, reflexive", () => {
  it("symmetric: similarity(a, b) === similarity(b, a)", () => {
    fc.assert(
      fc.property(arbFp(), arbFp(), (a, b) => {
        expect(Math.abs(insights.similarity(a, b) - insights.similarity(b, a))).toBeLessThan(1e-9);
      }),
      { numRuns: RUNS },
    );
  });

  it("bounded: similarity ∈ [0, 1]", () => {
    fc.assert(
      fc.property(arbFp(), arbFp(), (a, b) => {
        const s = insights.similarity(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
      { numRuns: RUNS },
    );
  });

  it("reflexive: similarity(a, a) ≈ 1", () => {
    fc.assert(
      fc.property(arbFp(), (a) => {
        expect(insights.similarity(a, a)).toBeCloseTo(1, 9);
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 8. slug — file-system + Obsidian safe output ──────────────────────

describe("property: slug — alphanumeric+dash, ≤80 chars, no border dashes", () => {
  it("output uses only safe chars, length capped, trimmed", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        const s = insights.slug(input);
        expect(s.length).toBeLessThanOrEqual(80);
        if (s.length > 0) {
          expect(s).not.toMatch(/^-/);
          expect(s).not.toMatch(/-$/);
          expect(/^[a-z0-9_-]*$/.test(s)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 9. extractTopicWord — total + reasonable output ──────────────────

describe("property: extractTopicWord — string-or-undefined, never throws", () => {
  it("returns non-empty string OR undefined", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (q) => {
        const w = insights.extractTopicWord(q);
        if (w !== undefined) {
          expect(typeof w).toBe("string");
          expect(w.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ─── 10. suggestFollowUps — capped count, valid shape ──────────────────

describe("property: suggestFollowUps — ≤3 items, every item well-formed", () => {
  it("returns ≤ 3 items with non-empty command + reason", () => {
    const arbResult = fc.record({
      commit: fc.record({
        hash: fc.string({ minLength: 7, maxLength: 40 }).filter((s) => s.length >= 7),
        shortHash: fc.string({ minLength: 7, maxLength: 7 }),
        authorName: fc.string({ minLength: 1, maxLength: 20 }),
        authorEmail: fc.string({ minLength: 5, maxLength: 30 }),
        authorDate: fc.constant("2024-01-01T00:00:00Z"),
        committerDate: fc.constant("2024-01-01T00:00:00Z"),
        subject: fc.string({ minLength: 1, maxLength: 80 }),
        body: fc.constant(""),
        parents: fc.constant([] as string[]),
        files: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 5 }),
      }),
      score: fc.float({ min: 0, max: 1, noNaN: true }),
      matchedChunks: fc.constant([] as never[]),
    });
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        fc.array(arbResult as fc.Arbitrary<Parameters<typeof insights.suggestFollowUps>[1][number]>, {
          maxLength: 10,
        }),
        (q, results) => {
          const out = insights.suggestFollowUps(q, results);
          expect(out.length).toBeLessThanOrEqual(3);
          for (const s of out) {
            expect(s.command.length).toBeGreaterThan(0);
            expect(s.reason.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

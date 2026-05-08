/**
 * v0.43 Holy Grail tests — pure-logic units (no git subprocess required).
 * The integration shape is exercised by the smoke tests in
 * tests/regression/no-throw.test.ts which run every command on an
 * empty repo and ensure nothing crashes.
 */
import { describe, expect, it } from "vitest";
import { computeBaseline, snapshotFromMri, type PulseSnapshot } from "./heartbeat.js";
import { buildInferences } from "./rewind.js";

describe("heartbeat — computeBaseline", () => {
  it("returns empty for empty history", () => {
    expect(computeBaseline([])).toEqual({});
  });
  it("computes mean + stdev per axis", () => {
    const history: PulseSnapshot[] = [
      { takenAt: "2026-05-01T00:00:00Z", axes: { x: 10, y: 100 } },
      { takenAt: "2026-05-02T00:00:00Z", axes: { x: 20, y: 200 } },
      { takenAt: "2026-05-03T00:00:00Z", axes: { x: 30, y: 300 } },
    ];
    const b = computeBaseline(history);
    expect(b.x!.mean).toBeCloseTo(20, 5);
    expect(b.x!.stdev).toBeCloseTo(10, 5);
    expect(b.y!.mean).toBeCloseTo(200, 5);
  });
  it("ignores non-finite values", () => {
    const history: PulseSnapshot[] = [
      { takenAt: "x", axes: { x: 10 } },
      { takenAt: "y", axes: { x: NaN } },
      { takenAt: "z", axes: { x: 30 } },
    ];
    const b = computeBaseline(history);
    expect(b.x!.n).toBe(2);
  });
  it("snapshotFromMri carries the asOf timestamp", () => {
    const snap = snapshotFromMri({ asOf: 1700000000, raw: { a: 1 }, results: [] } as any);
    expect(snap.takenAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(snap.axes.a).toBe(1);
  });
});

describe("rewind — buildInferences", () => {
  const baseCtx = {
    subject: "feat: add login",
    body: "",
    authorDateUtc: "2026-05-08T15:00:00Z",
    authorTzOffsetMinutes: 0,
    filesChanged: 3,
    insertions: 50,
    deletions: 5,
    before: [],
    after: [],
    revertedImmediately: false,
    sandwichMode: false,
    voice: undefined,
  };

  it("flags weekend commits", () => {
    // 2026-05-09 is a Saturday
    const ctx = { ...baseCtx, authorDateUtc: "2026-05-09T13:00:00Z" };
    const out = buildInferences(ctx);
    expect(out.some((s) => s.includes("Sat") || s.includes("weekend"))).toBe(true);
  });
  it("flags late-night commits", () => {
    const ctx = { ...baseCtx, authorDateUtc: "2026-05-08T02:00:00Z" };
    const out = buildInferences(ctx);
    expect(out.some((s) => s.includes("outside typical working hours"))).toBe(true);
  });
  it("flags sustained pushes (3+ commits within 2h)", () => {
    const ctx = {
      ...baseCtx,
      before: [
        { hash: "a", shortHash: "a", authorDate: "x", subject: "y", deltaMinutes: -30 },
        { hash: "b", shortHash: "b", authorDate: "x", subject: "y", deltaMinutes: -60 },
      ],
      after: [{ hash: "c", shortHash: "c", authorDate: "x", subject: "y", deltaMinutes: 30 }],
    };
    const out = buildInferences(ctx);
    expect(out.some((s) => s.includes("sustained push"))).toBe(true);
  });
  it("flags one-off commits when no surrounding context", () => {
    const out = buildInferences(baseCtx);
    expect(out.some((s) => s.includes("one-off"))).toBe(true);
  });
  it("flags reverted-immediately commits", () => {
    const out = buildInferences({ ...baseCtx, revertedImmediately: true });
    expect(out.some((s) => s.includes("reverted"))).toBe(true);
  });
  it("flags sandwich mode (WIP / fix attempt / trying to)", () => {
    const out = buildInferences({ ...baseCtx, subject: "wip: trying to fix x", sandwichMode: true });
    expect(out.some((s) => s.includes("hesitancy"))).toBe(true);
  });
  it("flags large-blast-radius commits", () => {
    const out = buildInferences({ ...baseCtx, filesChanged: 50, insertions: 800, deletions: 400 });
    expect(out.some((s) => s.includes("large blast radius"))).toBe(true);
  });
  it("flags surgical commits", () => {
    const out = buildInferences({ ...baseCtx, filesChanged: 1, insertions: 2, deletions: 1 });
    expect(out.some((s) => s.includes("surgical"))).toBe(true);
  });
  it("returns 'no unusual signals' for routine commits", () => {
    // mid-week, midday, average size, no surrounding context. before+after empty
    // would trigger one-off, so add some context.
    const ctx = {
      ...baseCtx,
      authorDateUtc: "2026-05-06T13:00:00Z", // Wednesday afternoon
      filesChanged: 3,
      insertions: 50,
      deletions: 5,
      before: [{ hash: "a", shortHash: "a", authorDate: "x", subject: "y", deltaMinutes: -300 }],
      after: [{ hash: "b", shortHash: "b", authorDate: "x", subject: "y", deltaMinutes: 600 }],
    };
    const out = buildInferences(ctx);
    expect(out.some((s) => s.includes("no unusual signals"))).toBe(true);
  });
});

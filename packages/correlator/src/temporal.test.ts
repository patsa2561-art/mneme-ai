import { describe, it, expect } from "vitest";
import { TemporalCorrelationEngine } from "./temporal.js";
import type { Commit, Incident } from "@mneme-ai/core";

const commit = (over: Partial<Commit> = {}): Commit => ({
  hash: "a".repeat(40),
  shortHash: "aaaaaaa",
  authorName: "Alice",
  authorEmail: "a@x.io",
  authorDate: "2025-01-01T00:00:00Z",
  committerDate: "2025-01-01T00:00:00Z",
  subject: "fix payment",
  body: "",
  parents: [],
  files: ["src/payment.ts"],
  ...over,
});

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: "INC-1",
  source: "manual",
  title: "Stripe webhook 500",
  occurredAt: "2025-01-02T00:00:00Z",
  severity: "error",
  affectedFiles: ["src/payment.ts"],
  ...over,
});

const ONE_DAY = 24 * 60 * 60 * 1000;

describe("TemporalCorrelationEngine", () => {
  const engine = new TemporalCorrelationEngine();

  it("correlates commit + incident within window", async () => {
    const out = await engine.correlate({
      commits: [commit()],
      incidents: [incident()],
      windowMs: 7 * ONE_DAY,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.fromKind).toBe("commit");
    expect(out[0]!.toKind).toBe("incident");
    expect(out[0]!.weight).toBeGreaterThan(0);
  });

  it("ignores incidents outside the window", async () => {
    const out = await engine.correlate({
      commits: [commit({ authorDate: "2024-01-01T00:00:00Z" })],
      incidents: [incident({ occurredAt: "2025-06-01T00:00:00Z" })],
      windowMs: 7 * ONE_DAY,
    });
    expect(out).toEqual([]);
  });

  it("ignores commits AFTER the incident", async () => {
    const out = await engine.correlate({
      commits: [commit({ authorDate: "2025-01-10T00:00:00Z" })],
      incidents: [incident({ occurredAt: "2025-01-02T00:00:00Z" })],
      windowMs: 30 * ONE_DAY,
    });
    expect(out).toEqual([]);
  });

  it("higher score for closer-in-time commits", async () => {
    const out = await engine.correlate({
      commits: [
        commit({ hash: "a".repeat(40), authorDate: "2025-01-01T23:00:00Z" }),
        commit({ hash: "b".repeat(40), authorDate: "2025-01-01T01:00:00Z" }),
      ],
      incidents: [incident({ occurredAt: "2025-01-02T00:00:00Z" })],
      windowMs: 7 * ONE_DAY,
    });
    expect(out.length).toBe(2);
    const closer = out.find((c) => c.fromId === "a".repeat(40))!;
    const farther = out.find((c) => c.fromId === "b".repeat(40))!;
    expect(closer.weight).toBeGreaterThan(farther.weight);
  });

  it("file overlap boosts the score", async () => {
    const c1 = commit({ hash: "a".repeat(40), files: ["src/payment.ts"] });
    const c2 = commit({ hash: "b".repeat(40), files: ["src/unrelated.ts"] });
    const inc = incident({ affectedFiles: ["src/payment.ts"] });
    const out = await engine.correlate({
      commits: [c1, c2],
      incidents: [inc],
      windowMs: 7 * ONE_DAY,
    });
    const overlap = out.find((c) => c.fromId === c1.hash)!;
    const noOverlap = out.find((c) => c.fromId === c2.hash);
    expect(overlap).toBeDefined();
    if (noOverlap) expect(overlap.weight).toBeGreaterThan(noOverlap.weight);
  });

  it("normalizes paths case-insensitively (Windows-friendly)", async () => {
    const out = await engine.correlate({
      commits: [commit({ files: ["SRC/Payment.TS"] })],
      incidents: [incident({ affectedFiles: ["src/payment.ts"] })],
      windowMs: 7 * ONE_DAY,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.reason).toMatch(/file overlap/i);
  });

  it("handles back-slash paths", async () => {
    const out = await engine.correlate({
      commits: [commit({ files: ["src\\payment.ts"] })],
      incidents: [incident({ affectedFiles: ["src/payment.ts"] })],
      windowMs: 7 * ONE_DAY,
    });
    expect(out.length).toBe(1);
  });

  it("respects minWeight threshold", async () => {
    const strict = new TemporalCorrelationEngine({ minWeight: 0.99 });
    const out = await strict.correlate({
      commits: [commit({ files: ["unrelated.ts"], authorDate: "2024-12-29T00:00:00Z" })],
      incidents: [incident({ affectedFiles: ["other.ts"] })],
      windowMs: 7 * ONE_DAY,
    });
    expect(out).toEqual([]);
  });

  it("produces deterministic correlation ids", async () => {
    const a = await engine.correlate({
      commits: [commit()],
      incidents: [incident()],
      windowMs: 7 * ONE_DAY,
    });
    const b = await engine.correlate({
      commits: [commit()],
      incidents: [incident()],
      windowMs: 7 * ONE_DAY,
    });
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  it("includes evidence array", async () => {
    const out = await engine.correlate({
      commits: [commit()],
      incidents: [incident()],
      windowMs: 7 * ONE_DAY,
    });
    expect(out[0]!.evidence).toEqual([commit().hash, "INC-1"]);
  });
});

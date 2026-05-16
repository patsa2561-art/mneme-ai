import { describe, it, expect } from "vitest";
import {
  emptyConsequenceLedger,
  recordRun,
  recordDelta,
  queryConsequences,
  verifyConsequenceLedger,
  listRecentRuns,
  formatConsequenceLine,
  type ConsequenceLedger,
} from "./index.js";

const SECRET = "csq-test-secret-887766";

function seedRuns(): { ledger: ConsequenceLedger; ids: string[] } {
  let l = emptyConsequenceLedger();
  const ids: string[] = [];
  l = recordRun({ ledger: l, cmd: "mneme.verify", args: { strict: true }, result: { ok: true }, repoStateBefore: "sha-A", recordedAtMs: 1_000_000, secret: SECRET });
  ids.push(l.records[l.records.length - 1]!.id);
  l = recordRun({ ledger: l, cmd: "mneme.verify", args: { strict: false }, result: { ok: true }, repoStateBefore: "sha-A", recordedAtMs: 1_001_000, secret: SECRET });
  ids.push(l.records[l.records.length - 1]!.id);
  l = recordRun({ ledger: l, cmd: "mneme.upgrade", args: {}, result: { newVersion: "2.19.14" }, repoStateBefore: "sha-A", recordedAtMs: 1_002_000, secret: SECRET });
  ids.push(l.records[l.records.length - 1]!.id);
  return { ledger: l, ids };
}

describe("v2.19.14 CONSEQUENCE LEDGER · recordRun", () => {
  it("records a run with HMAC-chained sig; resultDigest is sha256 of canonical result", () => {
    const { ledger, ids } = seedRuns();
    expect(ledger.records).toHaveLength(3);
    expect(ledger.records[0]!.prevSig).toBeNull();
    expect(ledger.records[1]!.prevSig).toBe(ledger.records[0]!.sig);
    expect(ledger.records[0]!.resultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(ids).toHaveLength(3);
  });

  it("records start with deltaSummary=null + repoStateAfter=null (delta arrives later)", () => {
    const { ledger } = seedRuns();
    expect(ledger.records.every((r) => r.deltaSummary === null && r.repoStateAfter === null)).toBe(true);
  });
});

describe("v2.19.14 CONSEQUENCE LEDGER · recordDelta", () => {
  it("appends a delta record for an existing run id", () => {
    const { ledger: l0, ids } = seedRuns();
    const r = recordDelta({
      ledger: l0,
      runId: ids[0]!,
      repoStateAfter: "sha-B",
      deltaSummary: { commitsAdded: 2, commitsRemoved: 3, filesChanged: 5, status: "rollback" },
      recordedAtMs: 1_000_000 + 24 * 60 * 60 * 1000,
      secret: SECRET,
    });
    expect(r.ok).toBe(true);
    expect(r.ledger.records).toHaveLength(4);
    const last = r.ledger.records[3]!;
    expect(last.id).toBe(ids[0]);
    expect(last.deltaSummary).toEqual({ commitsAdded: 2, commitsRemoved: 3, filesChanged: 5, status: "rollback" });
  });

  it("refuses to record delta for an unknown id", () => {
    const { ledger } = seedRuns();
    const r = recordDelta({ ledger, runId: "csq-doesnt-exist", repoStateAfter: "sha-X", deltaSummary: {}, secret: SECRET });
    expect(r.ok).toBe(false);
  });

  it("refuses to overwrite an already-recorded delta", () => {
    const { ledger: l0, ids } = seedRuns();
    const l1 = recordDelta({ ledger: l0, runId: ids[0]!, repoStateAfter: "sha-B", deltaSummary: { x: 1 }, recordedAtMs: 1_005_000, secret: SECRET }).ledger;
    const r = recordDelta({ ledger: l1, runId: ids[0]!, repoStateAfter: "sha-C", deltaSummary: { x: 2 }, recordedAtMs: 1_006_000, secret: SECRET });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("already recorded");
  });
});

describe("v2.19.14 CONSEQUENCE LEDGER · queryConsequences aggregation", () => {
  it("computes mean for numeric delta fields across runs", () => {
    let { ledger, ids } = seedRuns();
    ledger = recordDelta({ ledger, runId: ids[0]!, repoStateAfter: "B", deltaSummary: { commitsRemoved: 3, filesChanged: 5 }, recordedAtMs: 1_100_000, secret: SECRET }).ledger;
    ledger = recordDelta({ ledger, runId: ids[1]!, repoStateAfter: "C", deltaSummary: { commitsRemoved: 1, filesChanged: 2 }, recordedAtMs: 1_101_000, secret: SECRET }).ledger;
    const agg = queryConsequences({ ledger, cmd: "mneme.verify", nowMs: 2_000_000 });
    expect(agg.totalRuns).toBe(2);
    expect(agg.runsWithDelta).toBe(2);
    expect(agg.averages.commitsRemoved).toBe(2); // (3 + 1) / 2
    expect(agg.averages.filesChanged).toBe(3.5);
  });

  it("non-numeric delta fields become top-5 histograms sorted by count desc", () => {
    let { ledger, ids } = seedRuns();
    ledger = recordDelta({ ledger, runId: ids[0]!, repoStateAfter: "B", deltaSummary: { status: "rollback" }, recordedAtMs: 1_100_000, secret: SECRET }).ledger;
    ledger = recordDelta({ ledger, runId: ids[1]!, repoStateAfter: "C", deltaSummary: { status: "rollback" }, recordedAtMs: 1_101_000, secret: SECRET }).ledger;
    const agg = queryConsequences({ ledger, cmd: "mneme.verify", nowMs: 2_000_000 });
    expect(agg.histograms.status).toBeDefined();
    expect(agg.histograms.status![0]).toEqual({ value: "rollback", count: 2 });
  });

  it("windowMs filters older runs out", () => {
    const { ledger } = seedRuns();
    const agg = queryConsequences({ ledger, cmd: "mneme.verify", windowMs: 500, nowMs: 1_001_500 });
    // only the run at 1_001_000 falls within [1_001_000, 1_001_500]
    expect(agg.totalRuns).toBe(1);
  });

  it("query for an unseen cmd returns zeros + no averages", () => {
    const { ledger } = seedRuns();
    const agg = queryConsequences({ ledger, cmd: "mneme.never_run" });
    expect(agg.totalRuns).toBe(0);
    expect(agg.runsWithDelta).toBe(0);
    expect(Object.keys(agg.averages)).toHaveLength(0);
  });

  it("aggregates dedup by id (delta record overrides original)", () => {
    let { ledger, ids } = seedRuns();
    ledger = recordDelta({ ledger, runId: ids[0]!, repoStateAfter: "B", deltaSummary: { commitsRemoved: 7 }, recordedAtMs: 1_100_000, secret: SECRET }).ledger;
    const agg = queryConsequences({ ledger, cmd: "mneme.verify", nowMs: 2_000_000 });
    // totalRuns = 2 distinct ids for mneme.verify, not 3 (the dup record + original)
    expect(agg.totalRuns).toBe(2);
    expect(agg.runsWithDelta).toBe(1);
    expect(agg.averages.commitsRemoved).toBe(7);
  });
});

describe("v2.19.14 CONSEQUENCE LEDGER · verify + list + formatter", () => {
  it("verifyConsequenceLedger passes untampered chain", () => {
    let { ledger, ids } = seedRuns();
    ledger = recordDelta({ ledger, runId: ids[0]!, repoStateAfter: "B", deltaSummary: { x: 1 }, recordedAtMs: 1_100_000, secret: SECRET }).ledger;
    expect(verifyConsequenceLedger(ledger, SECRET).ok).toBe(true);
  });

  it("verifyConsequenceLedger detects tampered cmd at exact step", () => {
    const { ledger } = seedRuns();
    const tampered: ConsequenceLedger = {
      ...ledger,
      records: ledger.records.map((r, i) => (i === 1 ? { ...r, cmd: "mneme.evil" } : r)),
    };
    const v = verifyConsequenceLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("listRecentRuns returns latest-per-id, newest first, capped at limit", () => {
    let { ledger, ids } = seedRuns();
    ledger = recordDelta({ ledger, runId: ids[0]!, repoStateAfter: "B", deltaSummary: { x: 1 }, recordedAtMs: 1_100_000, secret: SECRET }).ledger;
    const list = listRecentRuns(ledger, { limit: 2 });
    expect(list).toHaveLength(2);
    // sorted descending by recordedAtMs (which is preserved on delta records)
    expect(list[0]!.recordedAtMs).toBeGreaterThanOrEqual(list[1]!.recordedAtMs);
  });

  it("formatter line shows cmd + run count + averages snippet with ⏳", () => {
    const line = formatConsequenceLine({
      cmd: "mneme.verify",
      totalRuns: 10,
      runsWithDelta: 8,
      averages: { commitsRemoved: 3.0, filesChanged: 5.5 },
      histograms: {},
      oldestRunMs: 0,
      newestRunMs: 1000,
    });
    expect(line).toContain("⏳");
    expect(line).toContain("mneme.verify");
    expect(line).toContain("commitsRemoved=3.0");
  });
});

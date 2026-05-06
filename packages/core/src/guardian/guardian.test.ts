import { describe, it, expect } from "vitest";
import { diagnose, selectAutoActions, type GuardianInput } from "./guardian.js";
import type { Commit } from "../types.js";
import type { IndexQualityReport } from "../indexer/quality.js";

function mkCommit(hash: string, date = "2024-01-01"): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: "A",
    authorEmail: "a@x.com",
    authorDate: date,
    committerDate: date,
    subject: "x",
    body: "",
    files: [],
    parents: [],
  };
}

function mkQuality(score: number, embedRatio = 1): IndexQualityReport {
  return {
    indexedCommits: 10,
    indexedChunks: 30,
    embeddedChunks: Math.round(30 * embedRatio),
    metrics: {
      chunkDensity: 1,
      embedRatio,
      subjectQuality: 1,
      bodyRatio: 1,
      prRatio: 1,
      issueRatio: 1,
      duplicateRatio: 0,
      tokenizerHealth: 1,
    },
    overallScore: score,
    grade: score >= 0.85 ? "A" : score >= 0.7 ? "B" : score >= 0.55 ? "C" : score >= 0.4 ? "D" : "F",
    recommendations: [],
  };
}

const baseInput: GuardianInput = {
  headCommits: [],
  indexedCommits: [],
  quality: mkQuality(0.9),
  lastQualityScore: 0.9,
  storeSchemaVersion: 3,
  expectedSchemaVersion: 3,
  feedbackEventsSinceCalibrate: 0,
};

describe("diagnose", () => {
  it("returns no findings when everything is healthy", () => {
    const r = diagnose(baseInput);
    expect(r.findings).toHaveLength(0);
    expect(r.summary.autoActions).toBe(0);
  });

  it("detects index drift when HEAD has commits not in index", () => {
    const r = diagnose({
      ...baseInput,
      headCommits: [mkCommit("new1"), mkCommit("new2"), mkCommit("indexed")],
      indexedCommits: [mkCommit("indexed")],
    });
    const drift = r.findings.find((f) => f.kind === "drift");
    expect(drift).toBeDefined();
    expect(drift!.policy).toBe("auto");
    expect(drift!.suggestedAction).toBe("mneme index");
  });

  it("escalates drift severity by count", () => {
    const lots = Array.from({ length: 60 }, (_, i) => mkCommit("c" + i));
    const r = diagnose({
      ...baseInput,
      headCommits: lots,
      indexedCommits: [],
    });
    const drift = r.findings.find((f) => f.kind === "drift")!;
    expect(drift.severity).toBe("high");
  });

  it("detects missing embeddings", () => {
    const r = diagnose({
      ...baseInput,
      quality: mkQuality(0.9, 0.7),
    });
    const missing = r.findings.find((f) => f.kind === "missing-embeddings");
    expect(missing).toBeDefined();
    expect(missing!.policy).toBe("auto");
  });

  it("flags low quality below floor", () => {
    const r = diagnose({
      ...baseInput,
      quality: mkQuality(0.4),
    });
    const low = r.findings.find((f) => f.kind === "low-quality");
    expect(low).toBeDefined();
    expect(low!.policy).toBe("recommended");
  });

  it("flags quality regression even when above floor", () => {
    const r = diagnose({
      ...baseInput,
      quality: mkQuality(0.7),
      lastQualityScore: 0.9,
    });
    const reg = r.findings.find(
      (f) =>
        f.kind === "low-quality" &&
        f.message.toLowerCase().includes("dropped"),
    );
    expect(reg).toBeDefined();
  });

  it("recommends calibrate when feedback accumulates", () => {
    const r = diagnose({
      ...baseInput,
      feedbackEventsSinceCalibrate: 50,
    });
    const stale = r.findings.find((f) => f.kind === "stale-calibration");
    expect(stale).toBeDefined();
    expect(stale!.policy).toBe("auto");
    expect(stale!.suggestedAction).toBe("mneme calibrate");
  });

  it("flags schema drift when store < expected", () => {
    const r = diagnose({
      ...baseInput,
      storeSchemaVersion: 2,
      expectedSchemaVersion: 3,
    });
    const sd = r.findings.find((f) => f.kind === "schema-drift");
    expect(sd).toBeDefined();
    expect(sd!.severity).toBe("high");
  });

  it("returns deterministic output for same input", () => {
    const a = diagnose({
      ...baseInput,
      headCommits: [mkCommit("a")],
      indexedCommits: [],
    });
    const b = diagnose({
      ...baseInput,
      headCommits: [mkCommit("a")],
      indexedCommits: [],
    });
    expect(a.findings).toEqual(b.findings);
  });
});

describe("selectAutoActions", () => {
  it("returns only auto-policy findings, sorted by severity", () => {
    const report = diagnose({
      ...baseInput,
      headCommits: [mkCommit("new1")], // low/medium drift → auto
      indexedCommits: [],
      storeSchemaVersion: 2, // high schema-drift → auto
      expectedSchemaVersion: 3,
      quality: mkQuality(0.4), // medium low-quality → recommended (not auto)
      feedbackEventsSinceCalibrate: 30, // low stale-calib → auto
    });
    const actions = selectAutoActions(report);
    // High severity should come first
    expect(actions[0]!.severity).toBe("high");
    // No "recommended" findings should be in the auto list
    for (const a of actions) expect(a.policy).toBe("auto");
  });
});

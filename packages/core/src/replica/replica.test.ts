import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDecision, recordOutcome, consultReplica, formatReplicaLine } from "./index.js";

describe("v2.14 · MNEME REPLICA — non-LLM oracle from history", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "replica-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("empty corpus → confidence 0, no recommendation", () => {
    const r = consultReplica({ question: "should I deploy on Friday?", repoDir: dir });
    expect(r.corpusSize).toBe(0);
    expect(r.recommendation).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recordDecision appends signed entry", () => {
    const d = recordDecision({ question: "Friday deploy ok?", action: "wait until Monday", features: { day: "Friday", risk: "high" }, repoDir: dir });
    expect(d.id).toMatch(/^d-/);
    expect(d.action).toBe("wait until Monday");
    expect(d.features.day).toBe("Friday");
  });

  it("consult recovers a matching past decision via features", () => {
    recordDecision({ question: "Should I deploy on Friday at 5pm?", action: "wait until Monday", features: { day: "Friday", risk: "high" }, repoDir: dir });
    const r = consultReplica({ question: "Friday deployment plan?", features: { day: "Friday", risk: "high" }, repoDir: dir });
    expect(r.recommendation).toBe("wait until Monday");
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.neighbours).toHaveLength(1);
  });

  it("recency decay: recent decision wins over old one with same features", () => {
    // Old decision: action A. Inject by hand-writing with old timestamp.
    const oldDecision = recordDecision({ question: "Friday deploy?", action: "deploy carefully", features: { day: "Friday" }, repoDir: dir });
    // Hack: directly rewrite to push ts back 365 days.
    const fs = require("node:fs");
    const path = require("node:path").join(dir, ".mneme", "replica", "decisions.jsonl");
    const lines = fs.readFileSync(path, "utf8").split("\n").filter((l: string) => l.length > 0);
    const old = JSON.parse(lines[0]);
    old.ts = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    lines[0] = JSON.stringify(old);
    fs.writeFileSync(path, lines.join("\n") + "\n");
    // Newer decision: action B with same features
    recordDecision({ question: "Friday deploy?", action: "DO NOT deploy", features: { day: "Friday" }, repoDir: dir });
    const r = consultReplica({ question: "Friday deploy?", features: { day: "Friday" }, repoDir: dir, halfLifeDays: 30 });
    // Recent should outweigh ancient
    expect(r.recommendation).toBe("DO NOT deploy");
  });

  it("outcome polarity shapes recommendation", () => {
    // Two competing decisions with same features but different outcomes
    const d1 = recordDecision({ question: "x", action: "approach A", features: { topic: "x" }, repoDir: dir });
    const d2 = recordDecision({ question: "x", action: "approach B", features: { topic: "x" }, repoDir: dir });
    recordOutcome({ id: d1.id, polarity: "bad", repoDir: dir });
    recordOutcome({ id: d2.id, polarity: "good", repoDir: dir });
    const r = consultReplica({ question: "x again", features: { topic: "x" }, repoDir: dir });
    // approach B (good outcome) gets a boost; should win
    expect(r.recommendation).toBe("approach B");
  });

  it("consults k neighbours and reports rationale", () => {
    for (let i = 0; i < 8; i++) {
      recordDecision({ question: `case ${i}`, action: i % 2 === 0 ? "left" : "right", features: { even: String(i % 2 === 0) }, repoDir: dir });
    }
    const r = consultReplica({ question: "case 9", features: { even: "false" }, k: 4, repoDir: dir });
    expect(r.neighbours).toHaveLength(4);
    expect(r.rationale.length).toBeGreaterThanOrEqual(2);
    expect(r.corpusSize).toBe(8);
  });

  it("confidence sums to ≤ 1.0 across top action share", () => {
    for (let i = 0; i < 5; i++) recordDecision({ question: "x", action: "A", features: { t: "x" }, repoDir: dir });
    recordDecision({ question: "x", action: "B", features: { t: "x" }, repoDir: dir });
    const r = consultReplica({ question: "x", features: { t: "x" }, k: 6, repoDir: dir });
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("HMAC sig is deterministic for same body shape", () => {
    recordDecision({ question: "test", action: "yes", repoDir: dir });
    const r1 = consultReplica({ question: "test", repoDir: dir });
    const r2 = consultReplica({ question: "test", repoDir: dir });
    // sig is over { recommendation, confidence, corpusSize } — should match
    expect(r1.sig).toBe(r2.sig);
  });

  it("recordOutcome throws for unknown id", () => {
    expect(() => recordOutcome({ id: "d-doesnotexist", polarity: "good", repoDir: dir })).toThrow();
  });

  it("formatReplicaLine summarises", () => {
    const d = recordDecision({ question: "x", action: "y", repoDir: dir });
    recordOutcome({ id: d.id, polarity: "good", repoDir: dir });
    const line = formatReplicaLine({ repoDir: dir });
    expect(line).toContain("REPLICA");
    expect(line).toContain("1 decisions");
    expect(line).toContain("1 with outcome");
  });

  it("works even when all AI is unavailable (zero LLM dep proof)", () => {
    // No fetch, no API — pure local crypto + filesystem.
    recordDecision({ question: "What if internet is down?", action: "use local cache", features: { offline: "true" }, repoDir: dir });
    const r = consultReplica({ question: "offline scenario", features: { offline: "true" }, repoDir: dir });
    expect(r.recommendation).toBe("use local cache");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readConsent,
  setConsent,
  harvest,
  distill,
  listWisdom,
  verifyChain,
  todayShardCount,
  type HarvestObservation,
} from "./harvest.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-osmosis-"));
}

const claudeObs: HarvestObservation = {
  vendor: "claude-opus-4-7",
  kind: "decision",
  text: "prefer Gist over clipboard for cross-machine",
  observedAt: "2026-05-13T10:00:00.000Z",
};

describe("v1.82 OSMOSIS · consent", () => {
  it("defaults to no opt-in, dailyCap 100", () => {
    const repo = tmpRepo();
    const c = readConsent(repo);
    expect(c.vendors).toEqual({});
    expect(c.dailyCap).toBe(100);
  });

  it("setConsent persists opt-in state", () => {
    const repo = tmpRepo();
    setConsent(repo, "claude-opus-4-7", true);
    const c = readConsent(repo);
    expect(c.vendors["claude-opus-4-7"]).toBe(true);
  });

  it("setConsent can revoke", () => {
    const repo = tmpRepo();
    setConsent(repo, "claude", true);
    setConsent(repo, "claude", false);
    expect(readConsent(repo).vendors["claude"]).toBe(false);
  });
});

describe("v1.82 OSMOSIS · harvest gate", () => {
  let repo: string;
  beforeEach(() => {
    repo = tmpRepo();
  });

  it("refuses to harvest without consent", () => {
    const r = harvest(repo, claudeObs);
    expect(r.recorded).toBe(false);
    expect(r.reason).toContain("not opted-in");
  });

  it("harvests after opt-in", () => {
    setConsent(repo, "claude-opus-4-7", true);
    const r = harvest(repo, claudeObs);
    expect(r.recorded).toBe(true);
  });

  it("rejects duplicate observation", () => {
    setConsent(repo, "claude-opus-4-7", true);
    expect(harvest(repo, claudeObs).recorded).toBe(true);
    expect(harvest(repo, claudeObs).recorded).toBe(false);
  });
});

describe("v1.82 OSMOSIS · distill + hash chain", () => {
  let repo: string;
  beforeEach(() => {
    repo = tmpRepo();
  });

  it("distill writes a signed shard with id + hash", () => {
    const s = distill(repo, [claudeObs], "prefer Gist over clipboard");
    expect(s.id).toMatch(/^[a-f0-9]{16}$/);
    expect(s.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.rule).toBe("prefer Gist over clipboard");
  });

  it("two consecutive shards form a hash chain", () => {
    const a = distill(repo, [claudeObs]);
    const b = distill(repo, [{ ...claudeObs, text: "second observation" }]);
    expect(b.prevHash).toBe(a.hash);
  });

  it("listWisdom returns newest-first", () => {
    distill(repo, [claudeObs]);
    distill(repo, [{ ...claudeObs, text: "newer" }]);
    const list = listWisdom(repo);
    expect(list.length).toBe(2);
    expect(list[0]!.observations[0]!.text).toBe("newer");
  });

  it("verifyChain returns valid on a clean log", () => {
    distill(repo, [claudeObs]);
    distill(repo, [{ ...claudeObs, text: "two" }]);
    distill(repo, [{ ...claudeObs, text: "three" }]);
    const r = verifyChain(repo);
    expect(r.valid).toBe(true);
    expect(r.brokenAtIndex).toBeNull();
  });

  it("verifyChain catches a tampered prevHash", () => {
    distill(repo, [claudeObs]);
    distill(repo, [{ ...claudeObs, text: "two" }]);
    // Tamper with line 2 by rewriting log directly.
    const path = join(repo, ".mneme/osmosis/wisdom.jsonl");
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const tampered = JSON.parse(lines[1]!);
    tampered.prevHash = "deadbeef";
    lines[1] = JSON.stringify(tampered);
    require("node:fs").writeFileSync(path, lines.join("\n") + "\n");
    const r = verifyChain(repo);
    expect(r.valid).toBe(false);
    expect(r.brokenAtIndex).toBe(1);
  });
});

describe("v1.82 OSMOSIS · todayShardCount", () => {
  it("counts only observations from today (UTC)", () => {
    const repo = tmpRepo();
    setConsent(repo, "claude", true);
    const today = new Date().toISOString();
    harvest(repo, { ...claudeObs, vendor: "claude", observedAt: today });
    harvest(repo, { vendor: "claude", kind: "reply", text: "x", observedAt: "2020-01-01T00:00:00Z" });
    expect(todayShardCount(repo)).toBe(1);
  });
});

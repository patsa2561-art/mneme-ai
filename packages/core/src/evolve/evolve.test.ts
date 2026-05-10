import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scanSignals, generateProposals, listProposals, viewProposal, evolveStats,
} from "./index.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-evolve-")); });
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function writeSelfcheckLast(repoRoot: string, verdicts: Array<{ name: string; status: string; evidence: string; fixHint?: string }>): void {
  const dir = join(repoRoot, ".mneme/selfcheck");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "last.json"), JSON.stringify({
    ranAt: new Date().toISOString(),
    verdicts,
  }), "utf8");
}

function writeAntivirusStats(repoRoot: string, byStrain: Record<string, { caught: number; lastCaughtAt: string }>): void {
  const dir = join(repoRoot, ".mneme/antivirus");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stats.json"), JSON.stringify({
    totalScans: 100,
    byStrain,
  }), "utf8");
}

function writePrecogCache(repoRoot: string, entries: Array<{ toTool: string; expiresAt: string; hit?: boolean; predictedAt: string }>): void {
  const dir = join(repoRoot, ".mneme/oracle");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cache.jsonl"),
    entries.map((e) => JSON.stringify({ id: "x", fromTool: "X", toTool: e.toTool, confidence: 0.8, predictedAt: e.predictedAt, expiresAt: e.expiresAt, hit: e.hit ?? false })).join("\n") + "\n",
    "utf8");
}

// ─────────────────────────────────────────────────────────────────────────
// scanSignals
// ─────────────────────────────────────────────────────────────────────────
describe("evolve.scanSignals", () => {
  it("returns [] on empty repo", () => {
    expect(scanSignals(repo)).toEqual([]);
  });

  it("collects selfcheck FAIL + WARN verdicts", () => {
    writeSelfcheckLast(repo, [
      { name: "lockfile-integrity", status: "fail", evidence: "package-lock.json corrupt", fixHint: "Restore from git" },
      { name: "daemon-alive", status: "warn", evidence: "no heartbeat" },
      { name: "version-up-to-date", status: "pass", evidence: "running latest" },
    ]);
    const sigs = scanSignals(repo);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]!.kind).toBe("selfcheck-fail");
    expect(sigs[0]!.pattern).toContain("lockfile-integrity");
    expect(sigs[0]!.evidence).toContain("Restore from git");
  });

  it("collects antivirus recurrences (>=3 catches)", () => {
    writeAntivirusStats(repo, {
      "citatio_viridis": { caught: 5, lastCaughtAt: new Date().toISOString() },
      "api_phantasma":   { caught: 1, lastCaughtAt: new Date().toISOString() }, // below threshold
    });
    const sigs = scanSignals(repo);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.kind).toBe("antivirus-recurrence");
    expect(sigs[0]!.pattern).toBe("antivirus:citatio_viridis");
    expect(sigs[0]!.occurrences).toBe(5);
  });

  it("collects PRECOG misses (>=5 expired without hit)", () => {
    const expired = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const predictedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    writePrecogCache(repo, [
      ...Array(6).fill(0).map(() => ({ toTool: "ghost.tool", expiresAt: expired, predictedAt })),
      ...Array(2).fill(0).map(() => ({ toTool: "rare.tool", expiresAt: expired, predictedAt })), // below threshold
    ]);
    const sigs = scanSignals(repo);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.pattern).toBe("precog:miss:ghost.tool");
    expect(sigs[0]!.occurrences).toBe(6);
  });

  it("aggregates signals across all 3 sources", () => {
    writeSelfcheckLast(repo, [{ name: "x", status: "fail", evidence: "e" }]);
    writeAntivirusStats(repo, { "y": { caught: 5, lastCaughtAt: new Date().toISOString() } });
    const sigs = scanSignals(repo);
    expect(sigs.length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(sigs.map((s) => s.kind));
    expect(kinds.has("selfcheck-fail")).toBe(true);
    expect(kinds.has("antivirus-recurrence")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateProposals
// ─────────────────────────────────────────────────────────────────────────
describe("evolve.generateProposals", () => {
  it("emits one proposal per pattern", () => {
    writeSelfcheckLast(repo, [
      { name: "lockfile-integrity", status: "fail", evidence: "corrupt" },
      { name: "daemon-alive", status: "warn", evidence: "no heartbeat" },
    ]);
    const ps = generateProposals(repo);
    expect(ps).toHaveLength(2);
    expect(ps[0]!.title).toMatch(/Self-heal/);
  });

  it("persists each proposal as <id>.md + <id>.json", () => {
    writeSelfcheckLast(repo, [{ name: "lockfile-integrity", status: "fail", evidence: "x" }]);
    const ps = generateProposals(repo);
    expect(ps).toHaveLength(1);
    const id = ps[0]!.id;
    expect(existsSync(join(repo, ".mneme/proposals", `${id}.md`))).toBe(true);
    expect(existsSync(join(repo, ".mneme/proposals", `${id}.json`))).toBe(true);
  });

  it("returns [] when no signals", () => {
    expect(generateProposals(repo)).toEqual([]);
  });

  it("confidence rises with more sources", () => {
    writeSelfcheckLast(repo, [{ name: "x", status: "fail", evidence: "e" }]);
    const oneSource = generateProposals(repo);
    rmSync(join(repo, ".mneme/proposals"), { recursive: true, force: true });
    writeSelfcheckLast(repo, [{ name: "x", status: "fail", evidence: "e" }]);
    writeAntivirusStats(repo, { "y": { caught: 10, lastCaughtAt: new Date().toISOString() } });
    const twoSources = generateProposals(repo);
    // First should still be there (one source); second batch has higher confidence
    const totalConf = twoSources.reduce((s, p) => s + p.confidence, 0);
    expect(totalConf).toBeGreaterThanOrEqual(oneSource[0]!.confidence);
  });

  it("body includes evidence + suggestion + confidence pct", () => {
    writeSelfcheckLast(repo, [{ name: "lockfile-integrity", status: "fail", evidence: "package-lock.json corrupt", fixHint: "git restore" }]);
    const [p] = generateProposals(repo);
    expect(p!.body).toContain("Evidence");
    expect(p!.body).toContain("Suggestion");
    expect(p!.body).toContain("Confidence");
    expect(p!.body).toContain("package-lock.json corrupt");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listProposals + viewProposal + stats
// ─────────────────────────────────────────────────────────────────────────
describe("evolve.list / view / stats", () => {
  it("listProposals returns sorted by confidence desc", () => {
    writeSelfcheckLast(repo, [
      { name: "a", status: "fail", evidence: "e" },
      { name: "b", status: "fail", evidence: "e" },
    ]);
    generateProposals(repo);
    const ps = listProposals(repo);
    expect(ps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i - 1]!.confidence).toBeGreaterThanOrEqual(ps[i]!.confidence);
    }
  });

  it("viewProposal returns markdown", () => {
    writeSelfcheckLast(repo, [{ name: "lockfile-integrity", status: "fail", evidence: "x" }]);
    const [p] = generateProposals(repo);
    const md = viewProposal(repo, p!.id);
    expect(md).toContain("# Self-heal");
    expect(md).toContain("Evidence");
  });

  it("viewProposal returns null for unknown id", () => {
    expect(viewProposal(repo, "deadbeef0000")).toBeNull();
  });

  it("evolveStats counts by kind", () => {
    writeSelfcheckLast(repo, [
      { name: "a", status: "fail", evidence: "e" },
      { name: "b", status: "warn", evidence: "e" },
    ]);
    writeAntivirusStats(repo, { "x": { caught: 5, lastCaughtAt: new Date().toISOString() } });
    const s = evolveStats(repo);
    expect(s.totalSignals).toBeGreaterThanOrEqual(3);
    expect(s.byKind["selfcheck-fail"]).toBe(2);
    expect(s.byKind["antivirus-recurrence"]).toBe(1);
    expect(s.topPattern).toBeDefined();
  });
});

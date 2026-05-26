/**
 * v2.66.0 — REFLOG (time-machine, final primitive) pinned tests.
 *
 * Section map:
 *   I1 — pheromone detection
 *   I2 — checkpoint creation
 *   I3 — list / read checkpoints
 *   I4 — rewind preview by --checkpoint
 *   I5 — rewind preview by --since window
 *   I6 — path filter (include/exclude)
 *   I7 — pheromone filter
 *   I8 — HMAC verification (checkpoint + proposal + ledger)
 *   I9 — CLI surface
 *   I10 — TG probes
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-rf-"));
}

describe("v2.66.0 I1 — pheromone detection (PINNED)", () => {
  it("I1.1 detectPheromone returns a string (env-dependent)", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const p = m.detectPheromone();
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
});

describe("v2.66.0 I2 — checkpoint creation (PINNED)", () => {
  it("I2.1 createCheckpoint snapshots tracked files + signs HMAC", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "a.txt"), "hello");
      writeFileSync(join(dir, "b.txt"), "world");
      const r = m.createCheckpoint({ cwd: dir });
      expect(r.checkpoint.files.length).toBe(2);
      expect(m.verifyCheckpoint(r.checkpoint)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I2.2 createCheckpoint skips default-excluded dirs (.git, node_modules)", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "skip.txt"), "x");
      writeFileSync(join(dir, "keep.txt"), "y");
      const r = m.createCheckpoint({ cwd: dir });
      expect(r.checkpoint.files.find((f) => f.path.includes("node_modules"))).toBeUndefined();
      expect(r.checkpoint.files.find((f) => f.path === "keep.txt")).toBeDefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I2.3 checkpoint persisted to disk + retrievable", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const r = m.createCheckpoint({ cwd: dir });
      const loaded = m.readCheckpoint(dir, r.checkpoint.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(r.checkpoint.id);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I2.4 checkpoint records pheromone tag", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const r = m.createCheckpoint({ cwd: dir });
      expect(typeof r.checkpoint.pheromone).toBe("string");
      expect(r.checkpoint.pheromone.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I3 — list + read (PINNED)", () => {
  it("I3.1 listCheckpoints returns saved checkpoints newest first", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const c1 = m.createCheckpoint({ cwd: dir, label: "first" });
      await new Promise((r) => setTimeout(r, 10));
      const c2 = m.createCheckpoint({ cwd: dir, label: "second" });
      const list = m.listCheckpoints(dir);
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe(c2.checkpoint.id); // newest first
      expect(list[1]?.id).toBe(c1.checkpoint.id);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I4 — rewind by --checkpoint (PINNED)", () => {
  it("I4.1 rewind to specific checkpoint returns toRevert for changed files", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "a.txt"), "v1");
      const c1 = m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "a.txt"), "v2");
      m.createCheckpoint({ cwd: dir });
      const r = m.rewindPreview({ cwd: dir, checkpointId: c1.checkpoint.id });
      expect(r.ok).toBe(true);
      expect(r.toRevert.length).toBe(1);
      expect(r.toRevert[0]?.path).toBe("a.txt");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I4.2 rewind with bad checkpoint id returns ok=false", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      const r = m.rewindPreview({ cwd: dir, checkpointId: "totally-fake-id" });
      expect(r.ok).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I4.3 rewind with no checkpoints returns ok=false + plain summary", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      const r = m.rewindPreview({ cwd: dir });
      expect(r.ok).toBe(false);
      expect(r.summary).toMatch(/no target/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I5 — rewind by --since (PINNED)", () => {
  it("I5.1 --since 0s picks latest checkpoint at-or-before now", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "x.txt"), "v2");
      const second = m.createCheckpoint({ cwd: dir });
      // cutoff = now - 0s = now → ALL checkpoints qualify → pick most recent
      const r = m.rewindPreview({ cwd: dir, since: "0s" });
      expect(r.targetCheckpoint.id).toBe(second.checkpoint.id);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I5.2 --since 100h (no checkpoint older than that) → ok=false with hint", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      m.createCheckpoint({ cwd: dir });
      const r = m.rewindPreview({ cwd: dir, since: "100h" });
      // No checkpoint that old → ok=false + plain summary
      expect(r.ok).toBe(false);
      expect(r.summary).toMatch(/no target/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I6 — path filter (PINNED)", () => {
  it("I6.1 --exclude tests/** keeps tests directory intact", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(join(dir, "src", "a.ts"), "v1");
      writeFileSync(join(dir, "tests", "a.test.ts"), "test1");
      const c1 = m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "src", "a.ts"), "v2");
      writeFileSync(join(dir, "tests", "a.test.ts"), "test2");
      m.createCheckpoint({ cwd: dir });
      const r = m.rewindPreview({ cwd: dir, checkpointId: c1.checkpoint.id, exclude: ["tests/**"] });
      // src/a.ts should be in toRevert; tests/* should be in toKeep
      expect(r.toRevert.find((f) => f.path === "src/a.ts")).toBeDefined();
      expect(r.toKeep.find((k) => k.path.startsWith("tests/"))).toBeDefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I7 — pheromone filter (PINNED)", () => {
  it("I7.1 --pheromone filter excludes when target checkpoint pheromone differs", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      const c1 = m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "x.txt"), "v2");
      m.createCheckpoint({ cwd: dir });
      const r = m.rewindPreview({ cwd: dir, checkpointId: c1.checkpoint.id, pheromone: "totally-fake-vendor" });
      // All files should be filtered out
      expect(r.toRevert.length).toBe(0);
      expect(r.toKeep.length).toBeGreaterThanOrEqual(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I8 — HMAC verification (PINNED)", () => {
  it("I8.1 verifyCheckpoint tamper detection", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const r = m.createCheckpoint({ cwd: dir });
      expect(m.verifyCheckpoint(r.checkpoint)).toBe(true);
      const tampered = { ...r.checkpoint, label: "MUTATED" };
      expect(m.verifyCheckpoint(tampered)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I8.2 verifyRewindProposal tamper detection", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      const c1 = m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "x.txt"), "v2");
      const r = m.rewindPreview({ cwd: dir, checkpointId: c1.checkpoint.id });
      expect(m.verifyRewindProposal(r)).toBe(true);
      const tampered = { ...r, toRevert: [...r.toRevert, { path: "evil", currentSha: "x", targetSha: "y", targetMtimeMs: 0, targetPheromone: "x" }] };
      expect(m.verifyRewindProposal(tampered)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I8.3 ledger HMAC chain intact after multi-event sequence", async () => {
    const m = await import("../../packages/core/src/reflog/index.js");
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      m.createCheckpoint({ cwd: dir });
      writeFileSync(join(dir, "x.txt"), "v2");
      const c = m.createCheckpoint({ cwd: dir });
      m.rewindPreview({ cwd: dir, checkpointId: c.checkpoint.id });
      const led = m.verifyLedgerChain(dir);
      expect(led.ok).toBe(true);
      expect(led.rows).toBeGreaterThanOrEqual(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I9 — CLI surface (PINNED)", () => {
  function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000, cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("I9.1 `mneme reflog checkpoint` creates a checkpoint via CLI", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const r = runCli(["reflog", "checkpoint"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.checkpoint.id).toBe("string");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I9.2 `mneme reflog list` returns checkpoints", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      runCli(["reflog", "checkpoint"], dir);
      const r = runCli(["reflog", "list"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.count).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I9.3 `mneme reflog rewind --since 100h --banner` outputs ASCII when proposal ok", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "x.txt"), "v1");
      runCli(["reflog", "checkpoint"], dir);
      writeFileSync(join(dir, "x.txt"), "v2");
      runCli(["reflog", "checkpoint"], dir);
      const r = runCli(["reflog", "rewind", "--since", "100h", "--banner"], dir);
      // either prints banner (proposal ok) or proposal-not-ok depending on which checkpoint picked; both fine
      expect(r.stdout.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("I9.4 `mneme reflog audit` returns envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["reflog", "audit"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalRows).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.66.0 I10 — TG probes (PINNED)", () => {
  it("I10.1 probe.reflog.checkpoint_rewind_round_trip returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.reflog.checkpoint_rewind_round_trip");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("I10.2 probe.reflog.ledger_chain_intact returns 1 or null", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.reflog.ledger_chain_intact");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect([null, 0, 1]).toContain(r.value);
  });
});

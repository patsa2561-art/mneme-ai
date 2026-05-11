import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeIndex, createSnapshot, restoreSnapshot, listSnapshots } from "./safe_index.js";

describe("safe_index (TIME-MACHINE)", () => {
  let repo: string; let dbPath: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-time-"));
    mkdirSync(join(repo, ".mneme/store"), { recursive: true });
    dbPath = join(repo, ".mneme/store/mneme.db");
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("createSnapshot", () => {
    it("returns null when source DB does not exist", () => {
      expect(createSnapshot(dbPath)).toBeNull();
    });
    it("copies the db to .mneme/snapshots/mneme.<sha>.db", () => {
      writeFileSync(dbPath, "fake-sqlite-data", "utf8");
      const snap = createSnapshot(dbPath);
      expect(snap).not.toBeNull();
      expect(snap!.sha8).toMatch(/^[0-9a-f]{8}$/);
      expect(existsSync(snap!.path)).toBe(true);
      expect(readFileSync(snap!.path, "utf8")).toBe("fake-sqlite-data");
    });
  });

  describe("restoreSnapshot", () => {
    it("restores a snapshot back to dbPath", () => {
      writeFileSync(dbPath, "original-data", "utf8");
      const snap = createSnapshot(dbPath);
      // Corrupt the original.
      writeFileSync(dbPath, "corrupted", "utf8");
      const r = restoreSnapshot(dbPath, snap!.sha8);
      expect(r.ok).toBe(true);
      expect(readFileSync(dbPath, "utf8")).toBe("original-data");
    });
    it("returns ok:false on missing snapshot sha", () => {
      const r = restoreSnapshot(dbPath, "deadbeef");
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("snapshot deadbeef not found");
    });
  });

  describe("listSnapshots", () => {
    it("returns [] when snapshot dir is missing", () => {
      expect(listSnapshots(repo)).toEqual([]);
    });
    it("lists snapshots newest first", async () => {
      writeFileSync(dbPath, "v1", "utf8");
      const s1 = createSnapshot(dbPath);
      // Wait a millisecond + change content + snapshot again to get a different sha.
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(dbPath, "v2", "utf8");
      const s2 = createSnapshot(dbPath);
      const all = listSnapshots(repo);
      expect(all.length).toBe(2);
      // Newest first.
      expect(Date.parse(all[0]!.takenAt)).toBeGreaterThanOrEqual(Date.parse(all[1]!.takenAt));
      // Both shas present.
      const shas = all.map((s) => s.sha8);
      expect(shas).toContain(s1!.sha8);
      expect(shas).toContain(s2!.sha8);
    });
  });

  describe("safeIndex", () => {
    it("happy path: snapshot + index + ok", async () => {
      writeFileSync(dbPath, "before", "utf8");
      const r = await safeIndex({
        dbPath,
        runIndex: async () => {
          writeFileSync(dbPath, "after", "utf8");
          return { commits: 10, chunks: 100 };
        },
      });
      expect(r.ok).toBe(true);
      expect(r.preSnapshot).not.toBeNull();
      expect(r.rolledBack).toBe(false);
      expect(r.commits).toBe(10);
      expect(r.chunks).toBe(100);
      expect(r.invariantViolations).toEqual([]);
      expect(readFileSync(dbPath, "utf8")).toBe("after");
    });

    it("rolls back on index throw", async () => {
      writeFileSync(dbPath, "before-throw", "utf8");
      const r = await safeIndex({
        dbPath,
        runIndex: async () => {
          // Indexer corrupts data + throws.
          writeFileSync(dbPath, "CORRUPT", "utf8");
          throw new Error("FTS5 missing mid-migration");
        },
      });
      expect(r.ok).toBe(false);
      expect(r.rolledBack).toBe(true);
      expect(r.rollbackReason).toContain("auto-rolled-back");
      expect(r.invariantViolations.some((v) => v.includes("FTS5 missing"))).toBe(true);
      // Critical: the original data is back.
      expect(readFileSync(dbPath, "utf8")).toBe("before-throw");
    });

    it("rolls back on invariant violation (commits > 0 but chunks == 0)", async () => {
      writeFileSync(dbPath, "before-inv", "utf8");
      const r = await safeIndex({
        dbPath,
        runIndex: async () => {
          writeFileSync(dbPath, "DESTROYED", "utf8");
          return { commits: 753, chunks: 0 };          // user's reported scenario
        },
      });
      expect(r.ok).toBe(false);
      expect(r.invariantViolations.some((v) => v.includes("invariant FAILED"))).toBe(true);
      expect(r.rolledBack).toBe(true);
      expect(readFileSync(dbPath, "utf8")).toBe("before-inv");
    });

    it("dry-run does NOT snapshot or modify the DB", async () => {
      writeFileSync(dbPath, "untouched", "utf8");
      const r = await safeIndex({
        dbPath,
        dryRun: true,
        runIndex: async () => ({ commits: 99, chunks: 999 }),
      });
      expect(r.dryRun).toBe(true);
      expect(r.preSnapshot).toBeNull();
      expect(r.commits).toBe(99);
      expect(r.chunks).toBe(999);
      expect(readFileSync(dbPath, "utf8")).toBe("untouched");
      expect(listSnapshots(repo)).toEqual([]);
    });

    it("first-ever index (no DB) succeeds without snapshot", async () => {
      // dbPath does NOT exist yet.
      const r = await safeIndex({
        dbPath,
        runIndex: async () => {
          writeFileSync(dbPath, "first", "utf8");
          return { commits: 1, chunks: 5 };
        },
      });
      expect(r.ok).toBe(true);
      expect(r.preSnapshot).toBeNull();      // no DB to snapshot
      expect(r.rolledBack).toBe(false);
    });
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  withSuperNova, withSuperNovaSync,
  registerObserver, clearObservers, listObservers,
  type Phase, type CallContext, type CallOutcome,
} from "./index.js";

describe("super_nova", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-sn-"));
    clearObservers();
  });
  afterEach(() => {
    clearObservers();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  describe("withSuperNova (async)", () => {
    it("returns the wrapped fn result + fires before/after observers", async () => {
      const phases: Phase[] = [];
      registerObserver({ id: "t", onPhase: (p) => { phases.push(p); } });
      const r = await withSuperNova({ verb: "test.ok", surface: "lib", repoRoot: repo }, async () => 42);
      expect(r).toBe(42);
      expect(phases).toEqual(["before", "after"]);
    });

    it("fires before + failure when fn throws (and rethrows)", async () => {
      const phases: Phase[] = [];
      registerObserver({ id: "t", onPhase: (p) => { phases.push(p); } });
      await expect(
        withSuperNova({ verb: "test.boom", surface: "lib", repoRoot: repo }, async () => { throw new Error("boom"); }),
      ).rejects.toThrow("boom");
      expect(phases).toEqual(["before", "failure"]);
    });

    it("writes experience row to .mneme/super_nova/experience.jsonl", async () => {
      await withSuperNova({ verb: "test.x", surface: "lib", repoRoot: repo }, async () => "hi");
      const f = join(repo, ".mneme/super_nova/experience.jsonl");
      expect(existsSync(f)).toBe(true);
      const lines = readFileSync(f, "utf8").trim().split("\n");
      expect(lines.length).toBe(1);
      const row = JSON.parse(lines[0]!);
      expect(row.verb).toBe("test.x");
      expect(row.ok).toBe(true);
      expect(typeof row.durationMs).toBe("number");
    });

    it("classifies failures into failureClass", async () => {
      await expect(
        withSuperNova({ verb: "test.eb", surface: "lib", repoRoot: repo }, async () => { throw new Error("EBUSY: resource busy"); }),
      ).rejects.toThrow();
      const row = JSON.parse(readFileSync(join(repo, ".mneme/super_nova/experience.jsonl"), "utf8").trim());
      expect(row.ok).toBe(false);
      expect(row.failureClass).toBe("lock-contention");
    });

    it("observer thrown errors do NOT break the caller", async () => {
      registerObserver({ id: "bad", onPhase: () => { throw new Error("observer crashed"); } });
      const r = await withSuperNova({ verb: "test.ok", surface: "lib", repoRoot: repo }, async () => 7);
      expect(r).toBe(7);
    });

    it("skipPool=true does not write experience row", async () => {
      await withSuperNova({ verb: "test.skip", surface: "lib", repoRoot: repo }, async () => 1, { skipPool: true });
      expect(existsSync(join(repo, ".mneme/super_nova/experience.jsonl"))).toBe(false);
    });

    it("phase filter only fires observer for opted-in phases", async () => {
      const phases: Phase[] = [];
      registerObserver({ id: "after-only", phases: ["after"], onPhase: (p) => { phases.push(p); } });
      await withSuperNova({ verb: "test.ok", surface: "lib", repoRoot: repo }, async () => 1);
      expect(phases).toEqual(["after"]);
    });
  });

  describe("withSuperNovaSync", () => {
    it("runs synchronously + writes experience row", () => {
      const phases: Phase[] = [];
      registerObserver({ id: "t", onPhase: (p) => { phases.push(p); } });
      const r = withSuperNovaSync({ verb: "test.sync", surface: "lib", repoRoot: repo }, () => "result");
      expect(r).toBe("result");
      expect(phases).toEqual(["before", "after"]);
      expect(existsSync(join(repo, ".mneme/super_nova/experience.jsonl"))).toBe(true);
    });
  });

  describe("observer registry", () => {
    it("listObservers returns registered ids", () => {
      registerObserver({ id: "a", onPhase: () => {} });
      registerObserver({ id: "b", onPhase: () => {} });
      expect(listObservers().sort()).toEqual(["a", "b"]);
    });
    it("registerObserver returns an unregister fn", () => {
      const off = registerObserver({ id: "z", onPhase: () => {} });
      expect(listObservers()).toContain("z");
      off();
      expect(listObservers()).not.toContain("z");
    });
  });
});

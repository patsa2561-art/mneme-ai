import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerCache, registerSource,
  markBuilt, isFresh, invalidate, invalidateSource,
  snapshotHologram, registerDefaultMnemeCaches,
} from "./cache_hologram.js";

describe("cache_hologram (PHOTONICS PROPAGATION)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-holo-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("registerCache + isFresh basics", () => {
    it("isFresh returns 'never-built' for unregistered cache", async () => {
      const r = await isFresh(repo, "nonexistent");
      expect(r.fresh).toBe(false);
      expect(r.reason).toBe("never-built");
    });

    it("isFresh returns 'no-cache-file' when registered but file missing", async () => {
      registerCache({
        id: "test-cache",
        relPath: ".mneme/test.json",
        ttlMs: 60000,
        dependsOn: [],
        description: "test",
      });
      const r = await isFresh(repo, "test-cache");
      expect(r.fresh).toBe(false);
      expect(r.reason).toBe("no-cache-file");
    });

    it("isFresh returns 'fresh' after markBuilt + cache file exists", async () => {
      registerCache({
        id: "fresh-cache",
        relPath: ".mneme/fresh.json",
        ttlMs: 60000,
        dependsOn: [],
        description: "test",
      });
      writeFileSync(join(repo, ".mneme/fresh.json"), "{}", "utf8");
      await markBuilt(repo, "fresh-cache");
      const r = await isFresh(repo, "fresh-cache");
      expect(r.fresh).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    it("isFresh returns 'ttl-expired' when builtAt is older than TTL", async () => {
      registerCache({
        id: "ttl-cache",
        relPath: ".mneme/ttl.json",
        ttlMs: 100,                              // 100ms TTL
        dependsOn: [],
        description: "test",
      });
      writeFileSync(join(repo, ".mneme/ttl.json"), "{}", "utf8");
      await markBuilt(repo, "ttl-cache");
      // Wait past the TTL.
      await new Promise((r) => setTimeout(r, 150));
      const r = await isFresh(repo, "ttl-cache");
      expect(r.fresh).toBe(false);
      expect(r.reason).toBe("ttl-expired");
    });

    it("ttlMs=0 means no time-based expiry (only photon-based)", async () => {
      registerCache({
        id: "no-ttl",
        relPath: ".mneme/notime.json",
        ttlMs: 0,
        dependsOn: [],
        description: "test",
      });
      writeFileSync(join(repo, ".mneme/notime.json"), "{}", "utf8");
      await markBuilt(repo, "no-ttl");
      // Wait an arbitrary amount; cache stays fresh because no TTL + no photon.
      await new Promise((r) => setTimeout(r, 50));
      const r = await isFresh(repo, "no-ttl");
      expect(r.fresh).toBe(true);
    });
  });

  describe("PHOTONICS -- photon-based invalidation", () => {
    it("isFresh returns 'photon-shift' when an upstream source changes", async () => {
      let currentValue = "v1.27.9";
      registerSource({
        id: "test-version",
        kind: "fn",
        compute: () => currentValue,
      });
      registerCache({
        id: "version-dependent",
        relPath: ".mneme/vdep.json",
        ttlMs: 0,
        dependsOn: ["test-version"],
        description: "version dependent",
      });
      writeFileSync(join(repo, ".mneme/vdep.json"), "{}", "utf8");
      await markBuilt(repo, "version-dependent");
      // Initially fresh.
      expect((await isFresh(repo, "version-dependent")).fresh).toBe(true);
      // Source shifts -> photon shifts -> cache becomes stale.
      currentValue = "v1.30.0";
      const r = await isFresh(repo, "version-dependent");
      expect(r.fresh).toBe(false);
      expect(r.reason).toBe("photon-shift");
      expect(r.shiftedSource).toBe("test-version");
    });

    it("invalidateSource propagates to every dependent cache", async () => {
      registerSource({ id: "shared-source", kind: "constant", value: "x" });
      registerCache({ id: "dep-a", relPath: ".mneme/a.json", ttlMs: 0, dependsOn: ["shared-source"], description: "A" });
      registerCache({ id: "dep-b", relPath: ".mneme/b.json", ttlMs: 0, dependsOn: ["shared-source"], description: "B" });
      registerCache({ id: "indep-c", relPath: ".mneme/c.json", ttlMs: 0, dependsOn: [], description: "C (no deps)" });
      writeFileSync(join(repo, ".mneme/a.json"), "{}", "utf8");
      writeFileSync(join(repo, ".mneme/b.json"), "{}", "utf8");
      writeFileSync(join(repo, ".mneme/c.json"), "{}", "utf8");
      await markBuilt(repo, "dep-a");
      await markBuilt(repo, "dep-b");
      await markBuilt(repo, "indep-c");

      const r = invalidateSource(repo, "shared-source");
      expect(r.invalidated.sort()).toEqual(["dep-a", "dep-b"]);
      // The independent cache survives.
      expect(existsSync(join(repo, ".mneme/c.json"))).toBe(true);
      expect(existsSync(join(repo, ".mneme/a.json"))).toBe(false);
      expect(existsSync(join(repo, ".mneme/b.json"))).toBe(false);
    });
  });

  describe("invalidate + force-rebuild loop", () => {
    it("invalidate deletes the cache file + clears hologram entry", async () => {
      registerCache({ id: "to-invalidate", relPath: ".mneme/inv.json", ttlMs: 0, dependsOn: [], description: "inv" });
      writeFileSync(join(repo, ".mneme/inv.json"), "{}", "utf8");
      await markBuilt(repo, "to-invalidate");
      const r = invalidate(repo, "to-invalidate");
      expect(r.invalidated).toBe(true);
      expect(existsSync(join(repo, ".mneme/inv.json"))).toBe(false);
      const fresh = await isFresh(repo, "to-invalidate");
      expect(fresh.reason).toBe("no-cache-file");
    });
  });

  describe("snapshotHologram", () => {
    it("returns a snapshot of every registered cache + a tally", async () => {
      registerCache({ id: "snap-a", relPath: ".mneme/snap-a.json", ttlMs: 0, dependsOn: [], description: "A" });
      registerCache({ id: "snap-b", relPath: ".mneme/snap-b.json", ttlMs: 0, dependsOn: [], description: "B" });
      writeFileSync(join(repo, ".mneme/snap-a.json"), "{}", "utf8");
      await markBuilt(repo, "snap-a");
      // snap-b is registered but never built -> stale.
      const snap = await snapshotHologram(repo);
      expect(snap.tally.total).toBeGreaterThanOrEqual(2);
      const a = snap.caches.find((c) => c.id === "snap-a");
      const b = snap.caches.find((c) => c.id === "snap-b");
      expect(a?.fresh).toBe(true);
      expect(b?.fresh).toBe(false);
    });
  });

  describe("registerDefaultMnemeCaches", () => {
    it("registers the standard set without throwing", () => {
      expect(() => registerDefaultMnemeCaches()).not.toThrow();
    });
  });
});

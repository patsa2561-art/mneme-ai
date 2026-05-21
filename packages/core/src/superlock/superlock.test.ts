import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isDevSource, autoUpgradeAllowed, acquireLock, releaseLock, isLockHeld, readLock, withSuperlock, devSourceMessage } from "./index.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const LOCK_PATH = join(homedir(), ".mneme-global", "superlock.flag");

describe("superlock", () => {
  describe("isDevSource", () => {
    it("recognises a dev checkout path", () => {
      expect(isDevSource("D:\\lib_ai_git\\packages\\cli\\bin\\mneme.js")).toBe(true);
      expect(isDevSource("/Users/dev/lib_ai_git/packages/cli/bin/mneme.js")).toBe(true);
      expect(isDevSource("C:\\src\\mneme-ai\\packages\\cli\\dist\\index.js")).toBe(true);
    });
    it("recognises a node_modules install as NOT dev", () => {
      expect(isDevSource("C:\\nvm4w\\nodejs\\node_modules\\mneme-ai\\bin\\mneme.js")).toBe(false);
      expect(isDevSource("/usr/local/lib/node_modules/mneme-ai/bin/mneme.js")).toBe(false);
      expect(isDevSource("/Users/x/.npm-global/lib/node_modules/mneme-ai/bin/mneme.js")).toBe(false);
    });
    it("returns false on explicit empty path (no argv fallback when caller opts out)", () => {
      expect(isDevSource("")).toBe(false);
    });
  });

  describe("autoUpgradeAllowed", () => {
    beforeEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });
    afterEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });

    it("refuses upgrade when running from dev source", () => {
      const r = autoUpgradeAllowed("D:\\lib_ai_git\\packages\\cli\\bin\\mneme.js");
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("dev-source-detected");
    });
    it("allows upgrade from real npm install when no lock held", () => {
      const r = autoUpgradeAllowed("/usr/local/lib/node_modules/mneme-ai/bin/mneme.js");
      expect(r.allowed).toBe(true);
      expect(r.reason).toBe("ok");
    });
  });

  describe("acquire/release lock", () => {
    beforeEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });
    afterEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });

    it("first acquire succeeds, second from different pid fails", () => {
      expect(acquireLock({ pid: 11111, role: "test", intent: "first try", holderPath: "/tmp/a" })).toBe(true);
      expect(isLockHeld()).toBe(true);
      // Try to acquire as a different pid while fresh lock is held.
      expect(acquireLock({ pid: 22222, role: "test", intent: "second try", holderPath: "/tmp/b" })).toBe(false);
    });
    it("release lets the next acquirer in", () => {
      expect(acquireLock({ pid: process.pid, role: "test", intent: "self", holderPath: "/tmp/x" })).toBe(true);
      expect(releaseLock(process.pid)).toBe(true);
      expect(isLockHeld()).toBe(false);
      expect(acquireLock({ pid: 33333, role: "test", intent: "next", holderPath: "/tmp/y" })).toBe(true);
    });
    it("readLock returns null when no lock exists", () => {
      expect(readLock()).toBeNull();
    });
  });

  describe("withSuperlock", () => {
    beforeEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });
    afterEach(() => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* */ } });

    it("runs fn, releases lock on success", async () => {
      const result = await withSuperlock({ role: "test", intent: "demo", holderPath: "/tmp/z" }, async () => {
        expect(isLockHeld()).toBe(true);
        return 42;
      });
      expect(result).toBe(42);
      expect(isLockHeld()).toBe(false);
    });
    it("releases lock even when fn throws", async () => {
      await expect(
        withSuperlock({ role: "test", intent: "boom", holderPath: "/tmp/z" }, async () => { throw new Error("boom"); }),
      ).rejects.toThrow("boom");
      expect(isLockHeld()).toBe(false);
    });
  });

  describe("devSourceMessage", () => {
    it("includes path, refusal, and remediation", () => {
      const msg = devSourceMessage("D:\\lib_ai_git\\packages\\cli\\bin\\mneme.js");
      expect(msg).toContain("dev source");
      expect(msg).toContain("REFUSED");
      expect(msg).toContain("git pull");
    });
  });
});

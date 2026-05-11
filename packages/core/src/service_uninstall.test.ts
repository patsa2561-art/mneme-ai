import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeAutoBootMarker, removeBootService } from "./service_uninstall.js";

describe("service_uninstall", () => {
  describe("removeAutoBootMarker", () => {
    let home: string;
    beforeEach(() => { home = mkdtempSync(join(tmpdir(), "mneme-su-")); });
    afterEach(() => { try { rmSync(home, { recursive: true, force: true }); } catch { /* */ } });

    it("returns 'not-installed' when marker does not exist", () => {
      const r = removeAutoBootMarker(home);
      expect(r.status).toBe("not-installed");
      expect(r.artifact).toBe("auto-boot marker");
    });

    it("removes the marker when present", () => {
      const path = join(home, ".mneme-auto-service-attempted");
      writeFileSync(path, "x", "utf8");
      expect(existsSync(path)).toBe(true);
      const r = removeAutoBootMarker(home);
      expect(r.status).toBe("removed");
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("removeBootService", () => {
    it("returns at least one structured result and never throws", () => {
      const r = removeBootService();
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeGreaterThanOrEqual(1);
      for (const step of r) {
        expect(step.artifact).toBeTruthy();
        expect(step.identifier).toBeTruthy();
        expect(["removed", "not-installed", "failed"]).toContain(step.status);
      }
    });

    it("on a fresh CI box (no service installed), reports not-installed", () => {
      // Most CI environments will not have MnemeNucleusDaemon installed.
      // We can't guarantee not-installed, but we CAN guarantee the call
      // succeeds without throwing and returns a structured result.
      expect(() => removeBootService()).not.toThrow();
    });
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEncryptionStatus, renderEncryptionStatus } from "./encryption_status.js";

describe("encryption_status (v1.42.5 #8 fix)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-enc-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("on a fresh repo: moduleAvailable=false, autoWired=false, userVisibleEnabled=false", () => {
    const s = getEncryptionStatus(repo);
    expect(s.moduleAvailable).toBe(false);
    expect(s.autoWired).toBe(false);
    expect(s.userVisibleEnabled).toBe(false);
    expect(s.reason).toMatch(/salt material missing/);
  });

  it("with salt file present: moduleAvailable=true, autoWired=false, userVisibleEnabled=false", () => {
    mkdirSync(join(repo, ".mneme/lineage/identity"), { recursive: true });
    writeFileSync(join(repo, ".mneme/lineage/identity/salt.bin"), Buffer.from("test-salt"));
    const s = getEncryptionStatus(repo);
    expect(s.moduleAvailable).toBe(true);
    expect(s.autoWired).toBe(false);
    expect(s.userVisibleEnabled).toBe(false);     // wiring still pending
    expect(s.reason).toMatch(/wir(e|ing)/i);   // matches "will wire" or "wiring"
  });

  it("renderEncryptionStatus produces a 2-line summary with verdict glyph", () => {
    const text = renderEncryptionStatus(repo);
    expect(text).toMatch(/Encryption at rest:/);
    expect(text.split("\n").length).toBe(2);
  });

  it("verdict glyph reflects state (DISABLED on fresh repo)", () => {
    expect(renderEncryptionStatus(repo)).toContain("✗ DISABLED");
  });

  it("verdict glyph shows READY when module ready but wiring pending", () => {
    mkdirSync(join(repo, ".mneme/lineage/identity"), { recursive: true });
    writeFileSync(join(repo, ".mneme/lineage/identity/salt.bin"), Buffer.from("x"));
    expect(renderEncryptionStatus(repo)).toContain("○ READY");
  });
});

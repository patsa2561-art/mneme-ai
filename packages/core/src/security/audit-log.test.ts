/**
 * audit-log — HMAC-SHA-256 chained tamper-evident log tests.
 *
 * Covers: append + verify round-trip · tampered entry detected · broken
 * chain detected · rotate behaviour · enable/disable · empty log handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  verify,
  readAll,
  readConfig,
  writeConfig,
  enable,
  disable,
  isEnabled,
  rotate,
  _GENESIS_PREV_HMAC_FOR_TESTS,
  _computeEntryHmacForTests,
  type AuditEntry,
} from "./audit-log.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-audit-"));
  // Use deterministic secret for tests
  process.env["MNEME_AUDIT_SECRET"] = "test-secret-with-enough-entropy-for-tests-32+";
});

afterEach(() => {
  delete process.env["MNEME_AUDIT_SECRET"];
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("audit-log — config", () => {
  it("disabled by default", () => {
    expect(isEnabled(tmp)).toBe(false);
  });

  it("enable + disable round-trip", () => {
    enable(tmp);
    expect(isEnabled(tmp)).toBe(true);
    disable(tmp);
    expect(isEnabled(tmp)).toBe(false);
  });

  it("config survives via writeConfig/readConfig", () => {
    writeConfig(tmp, { enabled: true });
    expect(readConfig(tmp).enabled).toBe(true);
  });
});

describe("audit-log — appendEntry behaviour", () => {
  it("returns null when disabled (no log file written)", () => {
    const r = appendEntry(tmp, { actor: "alice", action: "init" });
    expect(r).toBeNull();
    expect(existsSync(join(tmp, ".mneme", "audit.log"))).toBe(false);
  });

  it("returns hmac when enabled", () => {
    enable(tmp);
    const r = appendEntry(tmp, { actor: "alice", action: "init" });
    expect(r).toMatch(/^[a-f0-9]{64}$/);
  });

  it("appends multiple entries with chained prevHmac", () => {
    enable(tmp);
    const h1 = appendEntry(tmp, { actor: "a", action: "init" });
    const h2 = appendEntry(tmp, { actor: "a", action: "index" });
    const h3 = appendEntry(tmp, { actor: "a", action: "audit-baseline" });
    expect(h1).toBeTruthy();
    expect(h2).toBeTruthy();
    expect(h3).toBeTruthy();

    const entries = readAll(tmp);
    expect(entries.length).toBe(3);
    expect(entries[0]!.prevHmac).toBe(_GENESIS_PREV_HMAC_FOR_TESTS);
    expect(entries[1]!.prevHmac).toBe(h1);
    expect(entries[2]!.prevHmac).toBe(h2);
  });

  it("includes details field when provided", () => {
    enable(tmp);
    appendEntry(tmp, {
      actor: "alice",
      action: "vault-encrypt",
      target: "secret.txt",
      details: { bytes: 42, algorithm: "aes-256-gcm" },
    });
    const entries = readAll(tmp);
    expect(entries[0]!.details).toEqual({ bytes: 42, algorithm: "aes-256-gcm" });
    expect(entries[0]!.target).toBe("secret.txt");
  });
});

describe("audit-log — verify chain integrity", () => {
  it("verifies a valid chain", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });
    appendEntry(tmp, { actor: "a", action: "audit-certify" });

    const result = verify(tmp);
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(3);
    expect(result.brokenAtIndex).toBeUndefined();
  });

  it("verifies empty log", () => {
    const result = verify(tmp);
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  it("detects tampered actor field", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "alice", action: "init" });
    appendEntry(tmp, { actor: "alice", action: "index" });

    // Tamper: rewrite first line with different actor
    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]!) as AuditEntry;
    entry.actor = "mallory";
    lines[0] = JSON.stringify(entry);
    writeFileSync(logPath, lines.join("\n") + "\n");

    const result = verify(tmp);
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
    expect(result.brokenReason).toMatch(/hmac mismatch/);
  });

  it("detects tampered action field", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "alice", action: "init" });

    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]!) as AuditEntry;
    entry.action = "court-ruling"; // changed
    writeFileSync(logPath, JSON.stringify(entry) + "\n");

    const result = verify(tmp);
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it("detects deleted middle entry (chain break)", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });
    appendEntry(tmp, { actor: "a", action: "audit-baseline" });

    // Delete middle line
    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    writeFileSync(logPath, [lines[0], lines[2]].join("\n") + "\n");

    const result = verify(tmp);
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
    expect(result.brokenReason).toMatch(/prevHmac mismatch/);
  });

  it("detects swapped entries", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });

    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    writeFileSync(logPath, [lines[1], lines[0]].join("\n") + "\n");

    const result = verify(tmp);
    expect(result.ok).toBe(false);
  });

  it("detects non-JSON corruption", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });

    const logPath = join(tmp, ".mneme", "audit.log");
    writeFileSync(logPath, "this is not json\n");

    const result = verify(tmp);
    expect(result.ok).toBe(false);
    expect(result.brokenReason).toMatch(/non-JSON/);
  });
});

describe("audit-log — rotate", () => {
  it("rotates a populated log", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });

    const r = rotate(tmp, "alice");
    expect(r.rotated).toBe(true);
    expect(r.archivedPath).toMatch(/audit\.log\.rotated-/);
    expect(existsSync(r.archivedPath!)).toBe(true);

    // New log starts fresh with rotate entry
    const fresh = readAll(tmp);
    expect(fresh.length).toBe(1);
    expect(fresh[0]!.action).toBe("audit-log-rotate");
    expect(fresh[0]!.prevHmac).toBe(_GENESIS_PREV_HMAC_FOR_TESTS);
  });

  it("handles empty/missing log", () => {
    enable(tmp);
    const r = rotate(tmp, "alice");
    expect(r.rotated).toBe(false);
    const fresh = readAll(tmp);
    expect(fresh.length).toBe(1);
    expect(fresh[0]!.action).toBe("audit-log-rotate");
  });
});

describe("audit-log — _computeEntryHmac", () => {
  it("is deterministic for same inputs", () => {
    const body = { ts: "2026-05-08T00:00:00Z", actor: "a", action: "init" as const, target: undefined, details: undefined };
    const h1 = _computeEntryHmacForTests("secret", _GENESIS_PREV_HMAC_FOR_TESTS, body);
    const h2 = _computeEntryHmacForTests("secret", _GENESIS_PREV_HMAC_FOR_TESTS, body);
    expect(h1).toBe(h2);
  });

  it("changes with any field change", () => {
    const base = { ts: "2026-05-08T00:00:00Z", actor: "a", action: "init" as const, target: undefined, details: undefined };
    const h1 = _computeEntryHmacForTests("secret", _GENESIS_PREV_HMAC_FOR_TESTS, base);
    const h2 = _computeEntryHmacForTests("secret", _GENESIS_PREV_HMAC_FOR_TESTS, { ...base, actor: "b" });
    expect(h1).not.toBe(h2);
  });

  it("changes with different secret", () => {
    const body = { ts: "x", actor: "a", action: "init" as const, target: undefined, details: undefined };
    const h1 = _computeEntryHmacForTests("secret-1", _GENESIS_PREV_HMAC_FOR_TESTS, body);
    const h2 = _computeEntryHmacForTests("secret-2", _GENESIS_PREV_HMAC_FOR_TESTS, body);
    expect(h1).not.toBe(h2);
  });
});

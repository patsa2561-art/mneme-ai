/**
 * auto-bootstrap tests — security on by default.
 *
 * Verifies:
 *   • First call auto-enables audit log
 *   • Second call is a no-op (idempotent)
 *   • If user explicitly disabled, we DON'T silently re-enable
 *   • Bootstrap returns informative status (fips, enabled flags)
 *   • The genesis "auto-enabled" entry is recorded in the chain
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoBootstrap } from "./auto.js";
import { isEnabled, disable, readAll, verify } from "./audit-log.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-auto-"));
  process.env["MNEME_AUDIT_SECRET"] = "test-secret-with-enough-entropy-for-tests-32+";
});

afterEach(() => {
  delete process.env["MNEME_AUDIT_SECRET"];
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("auto-bootstrap — first run", () => {
  it("auto-enables audit log on first call", () => {
    expect(isEnabled(tmp)).toBe(false);
    const r = autoBootstrap(tmp);
    expect(r.auditLogAutoEnabled).toBe(true);
    expect(r.auditLogEnabled).toBe(true);
    expect(isEnabled(tmp)).toBe(true);
  });

  it("records a genesis 'auto-enabled' audit entry", () => {
    autoBootstrap(tmp);
    const entries = readAll(tmp);
    expect(entries.length).toBe(1);
    expect(entries[0]!.action).toBe("audit-log-enable");
    expect(entries[0]!.actor).toBe("mneme:auto");
    expect(entries[0]!.details).toMatchObject({ autoEnabled: true });
  });

  it("genesis entry is part of a valid HMAC chain", () => {
    autoBootstrap(tmp);
    const result = verify(tmp);
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(1);
  });

  it("returns a fipsActive boolean", () => {
    const r = autoBootstrap(tmp);
    expect(typeof r.fipsActive).toBe("boolean");
  });
});

describe("auto-bootstrap — idempotent on subsequent calls", () => {
  it("second call is a no-op (auditLogAutoEnabled=false)", () => {
    autoBootstrap(tmp);
    const r2 = autoBootstrap(tmp);
    expect(r2.auditLogAutoEnabled).toBe(false);
    expect(r2.auditLogEnabled).toBe(true);

    // Still only one entry — we didn't double-record
    const entries = readAll(tmp);
    expect(entries.length).toBe(1);
  });
});

describe("auto-bootstrap — respects explicit user choice", () => {
  it("does NOT silently re-enable a user who explicitly disabled", () => {
    autoBootstrap(tmp); // auto-enabled
    expect(isEnabled(tmp)).toBe(true);
    disable(tmp);
    expect(isEnabled(tmp)).toBe(false);

    // Subsequent bootstrap call must NOT flip enabled back on
    const r = autoBootstrap(tmp);
    expect(r.auditLogAutoEnabled).toBe(false);
    expect(r.auditLogEnabled).toBe(false);
    expect(isEnabled(tmp)).toBe(false);
  });
});

describe("auto-bootstrap — file safety", () => {
  it("creates .mneme directory on first call", () => {
    expect(existsSync(join(tmp, ".mneme"))).toBe(false);
    autoBootstrap(tmp);
    expect(existsSync(join(tmp, ".mneme"))).toBe(true);
  });
});

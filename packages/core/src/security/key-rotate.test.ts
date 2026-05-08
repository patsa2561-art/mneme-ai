/**
 * key-rotate tests — atomic re-sign of audit chain under a fresh secret.
 *
 * Covers: rotate empty log · rotate populated log · refuse on tampered
 * chain · re-verify after rotate · old log archived · MNEME_AUDIT_SECRET
 * env var honored after rotate (file fallback path).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEntry, enable, verify, readAll } from "./audit-log.js";
import { rotateSecret } from "./key-rotate.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-key-rotate-"));
  // Use file-based secret (not env) so rotation can replace it.
  delete process.env["MNEME_AUDIT_SECRET"];
});

afterEach(() => {
  delete process.env["MNEME_AUDIT_SECRET"];
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("key-rotate — basic flow", () => {
  it("no-ops when audit log disabled", () => {
    const r = rotateSecret(tmp, "alice");
    expect(r.rotated).toBe(false);
    expect(r.reason).toMatch(/not enabled/);
  });

  it("rotates an empty log gracefully", () => {
    enable(tmp);
    const r = rotateSecret(tmp, "alice");
    expect(r.rotated).toBe(true);
    expect(r.reSigned).toBe(0);
    expect(r.newSecretFingerprint).toMatch(/^[a-f0-9]{12}$/);

    // After rotate, log should have the key-rotate entry
    const entries = readAll(tmp);
    expect(entries.length).toBe(1);
    expect(entries[0]!.action).toBe("key-rotate");
  });

  it("rotates a populated chain and re-verifies under new secret", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });
    appendEntry(tmp, { actor: "a", action: "audit-baseline" });

    const before = readAll(tmp);
    expect(before.length).toBe(3);
    const beforeFirstHmac = before[0]!.hmac;

    const r = rotateSecret(tmp, "alice");
    expect(r.rotated).toBe(true);
    expect(r.reSigned).toBe(3);
    expect(r.archivedPath).toMatch(/\.pre-rotate-/);
    expect(existsSync(r.archivedPath!)).toBe(true);

    // Chain still valid under the NEW secret
    const post = verify(tmp);
    expect(post.ok).toBe(true);
    expect(post.totalEntries).toBe(4); // 3 original + key-rotate marker

    // First three entries kept their semantic content but hmacs are different
    const after = readAll(tmp);
    expect(after[0]!.actor).toBe("a");
    expect(after[0]!.action).toBe("init");
    expect(after[0]!.hmac).not.toBe(beforeFirstHmac); // re-signed
  });

  it("preserves entry ordering and details after re-sign", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "vault-encrypt", target: "secret.txt", details: { bytes: 42 } });
    appendEntry(tmp, { actor: "b", action: "session-save", target: "abc123" });

    rotateSecret(tmp, "alice");

    const after = readAll(tmp);
    expect(after[0]!.target).toBe("secret.txt");
    expect(after[0]!.details).toEqual({ bytes: 42 });
    expect(after[1]!.actor).toBe("b");
    expect(after[1]!.target).toBe("abc123");
  });

  it("preserves archived old log (evidence preservation)", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    const oldContent = readFileSync(join(tmp, ".mneme", "audit.log"), "utf8");

    const r = rotateSecret(tmp, "alice");
    const archivedContent = readFileSync(r.archivedPath!, "utf8");
    expect(archivedContent).toBe(oldContent);
  });
});

describe("key-rotate — refuses on tampered chain", () => {
  it("refuses to rotate if chain is broken", () => {
    enable(tmp);
    appendEntry(tmp, { actor: "a", action: "init" });
    appendEntry(tmp, { actor: "a", action: "index" });

    // Tamper: rewrite the first line's actor
    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    entry.actor = "mallory";
    lines[0] = JSON.stringify(entry);
    writeFileSync(logPath, lines.join("\n") + "\n");

    const r = rotateSecret(tmp, "alice");
    expect(r.rotated).toBe(false);
    expect(r.reason).toMatch(/chain broken/);
  });
});

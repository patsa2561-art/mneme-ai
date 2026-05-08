/**
 * security command — status/on/off/verify dashboard tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { securityCommand } from "./security.js";
import { security } from "@mneme-ai/core";
const { ensureAutoEnabled, isEnabled } = security.auditLog;

let tmp: string;
let chunks: string[];
let origWrite: typeof process.stdout.write;
let origErrWrite: typeof process.stderr.write;

function captureStdout() {
  chunks = [];
  origWrite = process.stdout.write.bind(process.stdout);
  origErrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = process.stdout.write;
}

function releaseStdout(): string {
  process.stdout.write = origWrite;
  process.stderr.write = origErrWrite;
  return chunks.join("");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-sec-cli-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
  process.env["MNEME_AUDIT_SECRET"] = "test-secret-with-enough-entropy-for-tests-32+";
  delete process.env["MNEME_NO_AUTO_SECURITY"];
});

afterEach(() => {
  delete process.env["MNEME_AUDIT_SECRET"];
  delete process.env["MNEME_NO_AUTO_SECURITY"];
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("security — status (default)", () => {
  it("shows audit log OFF on a fresh repo with no auto-bootstrap yet", async () => {
    captureStdout();
    let code: number;
    try { code = await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    expect(code).toBe(0);
    const out = JSON.parse(chunks.join(""));
    expect(out.auditLog.enabled).toBe(false);
    expect(out.modelChecksums.pinned).toBe(false);
  });

  it("after auto-bootstrap, status shows audit log ON + auto-enabled", async () => {
    ensureAutoEnabled(tmp);
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    const out = JSON.parse(chunks.join(""));
    expect(out.auditLog.enabled).toBe(true);
    expect(out.auditLog.autoEnabled).toBe(true);
    expect(out.auditLog.totalEntries).toBe(1);
  });

  it("reports MNEME_NO_AUTO_SECURITY env override when set", async () => {
    process.env["MNEME_NO_AUTO_SECURITY"] = "1";
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    const out = JSON.parse(chunks.join(""));
    expect(out.envOverride.autoSecurityDisabled).toBe(true);
    expect(out.scrubber.activeInMcp).toBe(false);
  });
});

describe("security — on / off", () => {
  it("`on` enables audit log", async () => {
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "on", json: true }); } finally { releaseStdout(); }
    expect(isEnabled(tmp)).toBe(true);
  });

  it("`off` disables audit log", async () => {
    ensureAutoEnabled(tmp);
    expect(isEnabled(tmp)).toBe(true);
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "off", json: true }); } finally { releaseStdout(); }
    expect(isEnabled(tmp)).toBe(false);
  });
});

describe("security — verify", () => {
  it("returns 0 on intact chain", async () => {
    ensureAutoEnabled(tmp);
    captureStdout();
    let code: number;
    try { code = await securityCommand({ cwd: tmp, action: "verify", json: true }); } finally { releaseStdout(); }
    expect(code).toBe(0);
    const out = JSON.parse(chunks.join(""));
    expect(out.auditLog.chainOk).toBe(true);
  });

  it("returns 1 on tampered chain", async () => {
    ensureAutoEnabled(tmp);
    // Tamper: rewrite the genesis entry's actor
    const logPath = join(tmp, ".mneme", "audit.log");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const e = JSON.parse(lines[0]!);
    e.actor = "mallory";
    lines[0] = JSON.stringify(e);
    writeFileSync(logPath, lines.join("\n") + "\n");

    captureStdout();
    let code: number;
    try { code = await securityCommand({ cwd: tmp, action: "verify", json: true }); } finally { releaseStdout(); }
    expect(code).toBe(1);
    const out = JSON.parse(chunks.join(""));
    expect(out.auditLog.chainOk).toBe(false);
  });
});

describe("security — model-checksums display", () => {
  it("shows PINNED when manifest exists", async () => {
    const manifestDir = join(tmp, ".mneme");
    require("node:fs").mkdirSync(manifestDir, { recursive: true });
    const manifest = {
      v: 1,
      files: { "model.onnx": { hash: "abc123", pinnedAt: "2026-05-08T00:00:00Z" } },
      pinnedByMnemeVersion: "1.11.1",
    };
    writeFileSync(join(manifestDir, "model-checksums.json"), JSON.stringify(manifest));

    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    const out = JSON.parse(chunks.join(""));
    expect(out.modelChecksums.pinned).toBe(true);
    expect(out.modelChecksums.fileCount).toBe(1);
  });

  it("shows not-pinned when manifest missing", async () => {
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    const out = JSON.parse(chunks.join(""));
    expect(out.modelChecksums.pinned).toBe(false);
  });

  it("treats malformed manifest as not-pinned", async () => {
    const manifestDir = join(tmp, ".mneme");
    require("node:fs").mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "model-checksums.json"), "this is not json");
    captureStdout();
    try { await securityCommand({ cwd: tmp, action: "status", json: true }); } finally { releaseStdout(); }
    const out = JSON.parse(chunks.join(""));
    expect(out.modelChecksums.pinned).toBe(false);
  });
});

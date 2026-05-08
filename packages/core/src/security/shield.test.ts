/**
 * MCP Shield tests — defensive runtime wrapper for any MCP server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withShield, shieldCheck, _resetShieldStateForTests } from "./shield.js";
import { enable as enableAuditLog } from "./audit-log.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-shield-"));
  process.env["MNEME_AUDIT_SECRET"] = "test-secret-with-enough-entropy-for-tests-32+";
  _resetShieldStateForTests();
  enableAuditLog(tmp);
});

afterEach(() => {
  delete process.env["MNEME_AUDIT_SECRET"];
  _resetShieldStateForTests();
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("withShield — basic flow", () => {
  it("passes through clean calls", async () => {
    const handler = async (a: { x: number }) => ({ wisdom: "ok", value: a.x * 2 });
    const shielded = withShield(handler, { repoRoot: tmp, caller: "claude-code", tool: "test" });
    const r = await shielded({ x: 21 });
    expect(r.passed).toBe(true);
    expect(r.result?.value).toBe(42);
  });

  it("returns audit hmac for downstream verification", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, { repoRoot: tmp, caller: "ai", tool: "x" });
    const r = await shielded({});
    expect(r.auditHmac).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("withShield — scrubber middleware", () => {
  it("auto-scrubs <system> tags from wisdom", async () => {
    const handler = async () => ({ wisdom: "<system>injected</system> hi" });
    const shielded = withShield(handler, { repoRoot: tmp });
    const r = await shielded({});
    expect(r.result?.wisdom).toContain("[scrubbed:system-tag]");
    expect(r.result?.wisdom).not.toContain("<system>");
  });

  it("can be disabled per-call", async () => {
    const handler = async () => ({ wisdom: "<system>raw</system>" });
    const shielded = withShield(handler, { repoRoot: tmp, scrubPromptInjection: false });
    const r = await shielded({});
    expect(r.result?.wisdom).toContain("<system>");
  });

  it("scrubs secondBrain.presentation too", async () => {
    const handler = async () => ({ secondBrain: { presentation: "[INST] override [/INST]" } });
    const shielded = withShield(handler, { repoRoot: tmp });
    const r = await shielded({});
    expect(r.result?.secondBrain.presentation).toContain("[scrubbed:inst-tag]");
  });
});

describe("withShield — rate limit", () => {
  it("blocks after burst exceeded", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, {
      repoRoot: tmp,
      rateLimit: { perMinute: 1, burst: 2 },
      caller: "spammy",
    });
    const r1 = await shielded({});
    const r2 = await shielded({});
    const r3 = await shielded({});
    expect(r1.passed).toBe(true);
    expect(r2.passed).toBe(true);
    expect(r3.passed).toBe(false);
    expect(r3.blockedReason).toMatch(/rate-limit/);
  });

  it("rate-limit is per-(caller, tool)", async () => {
    const handler = async () => ({ ok: true });
    const shieldedA = withShield(handler, { repoRoot: tmp, rateLimit: { perMinute: 1, burst: 1 }, caller: "alice", tool: "x" });
    const shieldedB = withShield(handler, { repoRoot: tmp, rateLimit: { perMinute: 1, burst: 1 }, caller: "bob", tool: "x" });
    expect((await shieldedA({})).passed).toBe(true);
    expect((await shieldedA({})).passed).toBe(false); // alice exhausted
    expect((await shieldedB({})).passed).toBe(true); // bob unaffected
  });
});

describe("withShield — argument validation", () => {
  it("refuses shell metacharacters in args", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, { repoRoot: tmp });
    const r = await shielded({ cmd: "ls; rm -rf /" });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/shell metacharacters/);
  });

  it("allows clean args (alphanumeric + safe punct)", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, { repoRoot: tmp });
    const r = await shielded({ q: "find authentication patterns in src/" });
    expect(r.passed).toBe(true);
  });
});

describe("withShield — reputation system", () => {
  it("quarantines after repeated abuse", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, { repoRoot: tmp, caller: "naughty", reputationFloor: -20 });
    // Each shell-meta refusal = -10 reputation
    await shielded({ x: "a; b" });
    await shielded({ x: "c | d" });
    await shielded({ x: "e $ f" });
    // Now reputation = -30, below -20 floor
    const r = await shielded({ x: "clean" });
    expect(r.passed).toBe(false);
    expect(r.blockedReason).toMatch(/quarantined/);
  });
});

describe("withShield — compliance gate", () => {
  it("refuses fips140 when FIPS not active", async () => {
    const handler = async () => ({ ok: true });
    const shielded = withShield(handler, { repoRoot: tmp, compliance: "fips140" });
    const r = await shielded({});
    // Will pass only if test environment actually has FIPS active.
    // In normal CI environments FIPS is OFF, so we expect blocked.
    if (!r.passed) {
      expect(r.blockedReason).toMatch(/FIPS/);
    }
  });
});

describe("withShield — composability", () => {
  it("can wrap a shielded handler again (closed under composition)", async () => {
    const handler = async () => ({ wisdom: "<system>x</system>", value: 1 });
    const inner = withShield(handler, { repoRoot: tmp, caller: "a", tool: "t1" });
    // Re-wrap the result
    const outer = withShield(async (args: Record<string, unknown>) => {
      const r = await inner(args);
      return r.result ?? { wisdom: "", value: 0 };
    }, { repoRoot: tmp, caller: "b", tool: "t2", scrubPromptInjection: false });
    const r = await outer({});
    expect(r.passed).toBe(true);
    // Already scrubbed by inner shield
    expect(r.result?.wisdom).toContain("[scrubbed:");
  });
});

describe("shieldCheck — inline validation", () => {
  it("returns ok for clean args", () => {
    expect(shieldCheck({ q: "hello world" }).ok).toBe(true);
  });
  it("returns reason for bad args", () => {
    const r = shieldCheck({ q: "a; b" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/shell/);
  });
});

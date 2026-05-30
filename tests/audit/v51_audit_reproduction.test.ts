// v2.51.0 — AUDIT REPRODUCTION SUITE
//
// User pasted an external-harness audit table claiming v2.50.0 had
// 4 regressions + 7 architectural items still persisting. The harness
// itself was outside the repo, so this file IS the canonical local
// reproduction — every metric the user reported is rebuilt here as
// an executable test so future regressions surface inside CI not in
// out-of-band screenshots.
//
// Tests are structured to FAIL when the bug is present + PASS when fixed.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");

function runMneme(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string>; timeout?: number } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: opts.timeout ?? 60_000, input: opts.input,
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  REGRESSION 1 — Edge case input: whitespace / unicode / null-byte
// ═══════════════════════════════════════════════════════════════════════
// User claim: v2.44.0 returned MIXED, v2.50.0 returned NONE × 4.
// Expected (v2.51): never NONE — must be either MIXED, IMPOSSIBLE_REFUTE,
// PASSTHROUGH with INPUT_TAMPERED caveat, or similar non-empty verdict.
// A categorical "I can't make a decision" verdict (NONE / undefined / "")
// is the actual bug.

describe("v2.51.0 REGRESSION 1 — edge-case input verdict (PINNED)", () => {
  it("R1.1 whitespace-only claim returns a real verdict (not NONE/empty)", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "   \t\n  ", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBeTruthy();
    expect(r.verdict).not.toBe("NONE" as unknown);
    expect(typeof r.verdict).toBe("string");
    expect(r.verdict.length).toBeGreaterThan(0);
  });

  it("R1.2 unicode-only claim (CJK/emoji) returns a real verdict", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "ก็คือ猫🎯🛡", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBeTruthy();
  });

  it("R1.3 null-byte mid-claim returns a real verdict + flags hygiene", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "claim with \x00 null byte", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBeTruthy();
    // Should also surface INPUT hygiene caveat
    expect(r.caveats.some((c) => /INPUT|TAMPERED|HYGIENE|NULL|CONTROL/i.test(c))).toBe(true);
  });

  it("R1.4 BIDI override returns a real verdict + flags hygiene", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "hello ‮ reversed", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBeTruthy();
    expect(r.caveats.some((c) => /INPUT|TAMPERED|HYGIENE|BIDI/i.test(c))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  REGRESSION 2 — MCP schema-bypass: malformed args MUST be rejected
// ═══════════════════════════════════════════════════════════════════════
// User claim: 13/20 → 15/20 rejected (5 still slip through). Expected
// (v2.51): 20/20 rejected. The validator must reject WRONG TYPES,
// PROTOTYPE-POLLUTION KEYS, and MISSING REQUIRED FIELDS.

describe("v2.51.0 REGRESSION 2 — MCP schema-bypass rejection (PINNED)", () => {
  it("R2.1 classifyToolName rejects every malicious shape (10/10)", async () => {
    const { classifyToolName } = await import("../../packages/mcp/src/deep_hardening/name_validator.js");
    const malicious = [
      "",                              // empty
      "../../../etc/passwd",           // path traversal
      "__proto__.constructor",         // proto pollution
      "x".repeat(200),                 // too long
      "🎯",                            // emoji / non-ASCII
      "Mneme.Capabilities",            // uppercase
      "evil.exec",                     // wrong namespace
      "mneme/foo",                     // slash
      "mneme..foo",                    // double dot
      "mneme.foo bar",                 // space
    ];
    for (const n of malicious) {
      expect(classifyToolName(n).ok, `expected rejection: ${JSON.stringify(n)}`).toBe(false);
    }
  });

  it("R2.2 classifyToolName rejects 10 more sneaky shapes (full 20/20)", async () => {
    const { classifyToolName } = await import("../../packages/mcp/src/deep_hardening/name_validator.js");
    const malicious2 = [
      "mneme.‮evil",              // BIDI override
      "mneme.foo\x00bar",              // null byte
      "mneme.foo\nbar",                // newline
      "mneme.foo\rbar",                // CR
      "mneme.foo\tbar",                // tab
      "mneme.constructor.foo",         // prototype subkey
      "mneme.prototype.bar",           // prototype subkey
      "mneme.foo.__proto__",           // proto on subkey
      "mneme.cyriℓlic",                // homoglyph (latin small letter l with stroke)
      "Mneme",                         // missing dot + uppercase
    ];
    for (const n of malicious2) {
      expect(classifyToolName(n).ok, `expected rejection: ${JSON.stringify(n)}`).toBe(false);
    }
  });

  it("R2.3 validateArgs rejects empty args on required-bearing tool", async () => {
    const { validateArgs } = await import("../../packages/mcp/src/deep_hardening/schema_required.js");
    const schema = { type: "object" as const, properties: { claim: { type: "string" } }, required: ["claim"] };
    expect(validateArgs({}, schema).ok).toBe(false);
    expect(validateArgs({ claim: 123 }, schema).ok).toBe(false); // wrong type
    expect(validateArgs({ claim: null }, schema).ok).toBe(false);
    expect(validateArgs({ claim: "ok" }, schema).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  REGRESSION 3 — MCP in-process throughput baseline
// ═══════════════════════════════════════════════════════════════════════
// User: 284 req/s → 255 req/s (-10%). Expected (v2.51): ≥ 250 req/s on
// average hardware. We measure name validation + schema gate at hot path
// since those are what every CallTool pays.

describe("v2.51.0 REGRESSION 3 — hot-path throughput (PINNED)", () => {
  it("R3.1 classifyToolName + validateArgs run >= 5000 ops/sec inline", async () => {
    const { classifyToolName } = await import("../../packages/mcp/src/deep_hardening/name_validator.js");
    const { validateArgs } = await import("../../packages/mcp/src/deep_hardening/schema_required.js");
    const schema = { type: "object" as const, properties: { claim: { type: "string" } }, required: ["claim"] };
    const N = 10_000;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      classifyToolName("mneme.verify.run");
      validateArgs({ claim: "x" }, schema);
    }
    const dt = Date.now() - t0;
    const opsPerSec = (N / dt) * 1000;
    expect(opsPerSec).toBeGreaterThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  REGRESSION 4 — Deterministic verdict lock (same claim → same verdict)
// ═══════════════════════════════════════════════════════════════════════
// User: 5 runs of same claim returned 2×IMPOSSIBLE + 3×NONE — hybrid
// pattern unchanged from v2.44 to v2.50. Expected (v2.51): all 5 runs
// return BIT-IDENTICAL verdict + confidence.

describe("v2.51.0 REGRESSION 4 — deterministic verdict lock (PINNED)", () => {
  it("R4.1 same factual claim returns same verdict + confidence 5×", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r4-"));
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(m.runACGV({ claim: "Mneme is a CLI tool", repoRoot: dir, noEmitVaccine: true, noStake: true }));
    }
    const verdicts = new Set(results.map((r) => r.verdict));
    const confs = new Set(results.map((r) => r.confidence));
    expect(verdicts.size, `verdicts not deterministic: ${[...verdicts].join(",")}`).toBe(1);
    expect(confs.size, `confidences not deterministic: ${[...confs].join(",")}`).toBe(1);
  });

  it("R4.2 same self-paradox returns same verdict 5×", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r4-"));
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(m.runACGV({ claim: "this statement is false", repoRoot: dir, noEmitVaccine: true, noStake: true }));
    }
    const verdicts = new Set(results.map((r) => r.verdict));
    expect(verdicts.size).toBe(1);
  });

  it("R4.3 same fake-commit-hash claim returns same verdict 5×", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r4-"));
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(m.runACGV({ claim: "commit abcdef1234567890abcdef1234567890abcdef12 fixes the bug", repoRoot: dir, noEmitVaccine: true, noStake: true }));
    }
    const verdicts = new Set(results.map((r) => r.verdict));
    expect(verdicts.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  R1 — META-SELF-VERIFIER actually fires on Mneme self-claims
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 R1 — self-verify routes to META-SELF-VERIFIER (PINNED)", () => {
  it("R1arch.1 'Mneme is a CLI tool' returns FUSION (not IMPOSSIBLE_REFUTE)", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "Mneme is a CLI tool", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
    expect(r.verdict).toBe("FUSION");
    expect(r.caveats.some((c) => /META_SELF/i.test(c))).toBe(true);
  });

  it("R1arch.2 'Mneme is a quantum GPU shader' is refuted (BLACK_HOLE or IMPOSSIBLE_REFUTE)", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "Mneme is a quantum GPU shader", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    // v2.114 — a refuted SELF-claim now resolves to IMPOSSIBLE_REFUTE (chandra
    // collapse + godel UNSAT against the capability corpus = the strongest
    // refute), consistent with the canonical Rust-lie test + acgv_explain +
    // runACGVAsync. Both tiers are valid refutations; the pin is intentionally
    // non-brittle about which.
    expect(["BLACK_HOLE", "IMPOSSIBLE_REFUTE"]).toContain(r.verdict);
  });

  it("R1arch.3 'Mneme uses HMAC chain' returns FUSION", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const r = m.runACGV({ claim: "Mneme uses HMAC for verifiable receipts", repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("FUSION");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  R3 — Truncation receipt is VISIBLE on user-facing output
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 R3 — truncation receipt visible (PINNED)", () => {
  it("R3arch.1 50KB claim via --stdin shows truncation receipt in stdout", () => {
    const big = "x".repeat(50_000);
    const r = runMneme(["verify", "--stdin", "--json"], { input: big });
    expect(r.status).toBeLessThan(2);
    // Receipt should mention either INPUT_TRUNCATED, TRUNCATION, "of 50000", or similar
    expect(r.stdout).toMatch(/TRUNCAT|truncated|of 50000|50000 chars/i);
  });

  it("R3arch.2 ACGV result carries truncation caveat for >8KB input", async () => {
    const m = await import("../../packages/core/src/squadron/acgv.js");
    const big = "x".repeat(50_000);
    const r = m.runACGV({ claim: big, repoRoot: tmpdir(), noEmitVaccine: true, noStake: true });
    expect(r.caveats.some((c) => /TRUNC/i.test(c))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  R4 — Lineage no TypeError on missing rootPath (defensive helpers)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 R4 — lineage defensive (PINNED)", () => {
  it("R4arch.1 lineage helpers do not throw on absent rootPath", async () => {
    const m = await import("../../packages/core/src/people/lineage.js");
    // Walk public surface; call any function we can with empty/undefined
    // and assert NONE throw TypeError. Use exported symbol set.
    const errors: string[] = [];
    for (const k of Object.keys(m)) {
      const fn = (m as Record<string, unknown>)[k];
      if (typeof fn !== "function") continue;
      try { (fn as (...args: unknown[]) => unknown)(undefined); } catch (e) {
        if (/TypeError|Cannot read|undefined/i.test((e as Error).message)) errors.push(`${k}: ${(e as Error).message}`);
      }
      try { (fn as (...args: unknown[]) => unknown)({}); } catch (e) {
        if (/TypeError|Cannot read|undefined/i.test((e as Error).message)) errors.push(`${k}({}): ${(e as Error).message}`);
      }
    }
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  R7 — cli-activity HMAC chain integrity
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 R7 — cli-activity HMAC integrity (PINNED)", () => {
  it("R7arch.1 verifyCliActivity returns ok=true for absent ledger", async () => {
    const m = await import("../../packages/core/src/ai_handshake.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r7-"));
    const r = m.verifyCliActivity(dir);
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(0);
  });

  it("R7arch.2 verifyCliActivity detects tampering at exact row", async () => {
    const m = await import("../../packages/core/src/ai_handshake.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r7-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    // Write a forged row with bad HMAC
    appendFileSync(join(dir, ".mneme", "cli-activity.jsonl"),
      JSON.stringify({ at: "2025-01-01T00:00:00Z", vendor: "x", command: "y", day: 1, prev: "0".repeat(64), hmac: "deadbeef".padEnd(64, "0") }) + "\n");
    const r = m.verifyCliActivity(dir);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(0);
    expect(r.reason).toMatch(/hmac mismatch/i);
  });

  it("R7arch.3 live repo's ledger verifies after v2.50 cleanse + re-chain", async () => {
    const m = await import("../../packages/core/src/ai_handshake.js");
    const r = m.verifyCliActivity(resolve(__dirname, "../.."));
    expect(r.ok, r.reason ?? "").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  R8 — Cross-process Phoenix respawn install + dry-run
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 R8 — cross-process Phoenix (PINNED)", () => {
  it("R8arch.1 detectMechanism returns a real OS mechanism (not noop on win/mac/linux)", async () => {
    const m = await import("../../packages/core/src/bridge_phoenix/cross_process.js");
    const mech = m.detectMechanism();
    expect(["schtasks", "launchd", "systemd-user", "cron", "node-self-supervisor"]).toContain(mech);
  });

  it("R8arch.2 dry-run install returns the exact command + ok=true", async () => {
    const m = await import("../../packages/core/src/bridge_phoenix/cross_process.js");
    const dir = mkdtempSync(join(tmpdir(), "v51-r8-"));
    const r = m.installCrossProcessWatchdog({ repoRoot: dir, cmd: "mneme bridge --detach", dryRun: true });
    expect(r.ok).toBe(true);
    expect(typeof r.command).toBe("string");
    expect((r.command ?? "").length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  TOOL_FUZZ — MCP server entry rejects every malicious tool name
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 TOOL_FUZZ — MCP entry rejects malicious names (PINNED)", () => {
  it("FUZZ.1 classifyToolName rejects type-confusion (number/object/null/undefined)", async () => {
    const { classifyToolName } = await import("../../packages/mcp/src/deep_hardening/name_validator.js");
    expect(classifyToolName(null).ok).toBe(false);
    expect(classifyToolName(undefined).ok).toBe(false);
    expect(classifyToolName(123 as unknown).ok).toBe(false);
    expect(classifyToolName({} as unknown).ok).toBe(false);
    expect(classifyToolName([] as unknown).ok).toBe(false);
  });

  it("FUZZ.2 classifyToolName accepts every legitimate Mneme shape", async () => {
    const { classifyToolName } = await import("../../packages/mcp/src/deep_hardening/name_validator.js");
    const ok = [
      "mneme.verify",
      "mneme.verify.run",
      "mneme.system.upgrade",
      "mneme.aletheia.immune.scan",
      "mneme.a.b.c.d.e.f",
      "mneme.a_b.c1.d2_e3",
    ];
    for (const n of ok) {
      expect(classifyToolName(n).ok, `expected accept: ${n}`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CANCEL — notifications/cancelled propagates AbortSignal
// ═══════════════════════════════════════════════════════════════════════

describe("v2.51.0 CANCEL — AbortSignal propagation (PINNED)", () => {
  it("CANCEL.1 register/cancel/unregister round-trip fires abort with reason", async () => {
    const { cancelManager } = await import("../../packages/mcp/src/deep_hardening/cancel_manager.js");
    const sig = cancelManager.register("test-id-1", "mneme.test");
    expect(sig.aborted).toBe(false);
    const ok = cancelManager.cancel("test-id-1", "user-cancelled");
    expect(ok).toBe(true);
    expect(sig.aborted).toBe(true);
    cancelManager.unregister("test-id-1");
  });

  it("CANCEL.2 cancel on unknown id returns false (not crash)", async () => {
    const { cancelManager } = await import("../../packages/mcp/src/deep_hardening/cancel_manager.js");
    expect(cancelManager.cancel("nonexistent-id", "x")).toBe(false);
  });

  it("CANCEL.3 abort reason is preserved", async () => {
    const { cancelManager } = await import("../../packages/mcp/src/deep_hardening/cancel_manager.js");
    const sig = cancelManager.register("test-id-3", "mneme.test");
    cancelManager.cancel("test-id-3", "specific-reason-xyz");
    expect(sig.aborted).toBe(true);
    const reason = (sig as AbortSignal & { reason?: { message?: string } }).reason;
    expect(reason?.message).toMatch(/specific-reason-xyz/);
    cancelManager.unregister("test-id-3");
  });
});

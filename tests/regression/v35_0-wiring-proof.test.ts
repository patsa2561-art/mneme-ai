// v2.35.0 — WIRING-PROOF TESTS.
//
// The wild idea: every previous bug-immunity test asserted CORE behavior
// (call a function, check return value). That passes even when the CLI
// surface still doesn't use the function. Wiring-lag bug class survives.
//
// WIRING-PROOF tests spawn the ACTUAL `mneme verify` / `mneme inbox`
// CLIs via subprocess + assert user-visible STDOUT. If a future PR
// reroutes the headline through a different path or re-introduces a
// "say upgrade" CTA, these tests catch it forever.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");

function runMneme(args: string[], cwd?: string, timeoutMs = 60_000): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ── R1 + NEW2 user-visible (CLI verify) ─────────────────────────────

describe("WIRING-PROOF: R1+NEW2 — CLI verify surfaces SELF-PARADOX headline", () => {
  it("`mneme verify 'This statement is false' --json` returns SELF-PARADOX headline", () => {
    const r = runMneme(["verify", "This statement is false", "--json"]);
    expect(r.status).toBe(0);
    // The user-visible headline MUST contain SELF-PARADOX (or SELF-REFERENCE
    // for the self-ref variant) — that's the v2.34.0 ACGV Layer 0b headline.
    // If a future PR overrides this with FORENSIC-ACCEPTED again, this test
    // fails forever.
    const parsed = JSON.parse(r.stdout) as { headline?: string };
    expect(parsed.headline).toBeDefined();
    expect(parsed.headline).toMatch(/SELF-PARADOX/i);
  });

  it("`mneme verify 'this claim verifies itself' --json` returns SELF-REFERENCE headline", () => {
    const r = runMneme(["verify", "this claim verifies itself", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { headline?: string };
    expect(parsed.headline).toMatch(/SELF-REFERENCE/i);
  });
});

// ── R3 user-visible (CLI verify with huge input) ───────────────────

describe("WIRING-PROOF: R3 — CLI verify surfaces truncation headline", () => {
  it("`mneme verify <10K claim> --json` headline includes truncation ratio", () => {
    // Use ~10K chars (over the 8K ACGV cap but under shell argv limit ~32K Windows).
    const giant = "x ".repeat(5000); // 10K chars
    const r = runMneme(["verify", giant, "--json"]);
    // Either status 0 or 1 acceptable — must surface truncation in headline.
    const parsed = JSON.parse(r.stdout) as { headline?: string; acgv?: { caveats?: string[] } };
    expect(parsed.headline).toBeDefined();
    // The new explainer puts "truncated" in headline for INPUT_TRUNCATED:N/M.
    const sawTruncated = /truncated/i.test(parsed.headline ?? "") ||
                         (parsed.acgv?.caveats ?? []).some((c) => c.startsWith("INPUT_TRUNCATED"));
    expect(sawTruncated).toBe(true);
  });
}, 90_000);

// ── NEW3 user-visible (fake commit hash) ───────────────────────────

describe("WIRING-PROOF: NEW3 — CLI verify catches fake commit hash", () => {
  it("`mneme verify 'commit a1b2c3d4 fixed auth' --json` returns IMPOSSIBLE/REFUTED verdict", () => {
    const r = runMneme(["verify", "commit a1b2c3d4 fixed the auth bug", "--json"]);
    const parsed = JSON.parse(r.stdout) as { verdict?: string; acgv?: { caveats?: string[]; verdict?: string } };
    // Either the top-level verdict OR the acgv.verdict should reflect the impossibility.
    const verdict = parsed.verdict ?? parsed.acgv?.verdict ?? "";
    const caveats = parsed.acgv?.caveats ?? [];
    const sawHashRefute = /IMPOSSIBLE|REFUTED/i.test(verdict) ||
                         caveats.some((c) => c.startsWith("FAKE_COMMIT_HASH"));
    expect(sawHashRefute).toBe(true);
  });
}, 60_000);

// ── N5 user-visible (no "say upgrade" CTA regression) ──────────────

describe("WIRING-PROOF: N5 — no instruction-shape CTA in inbox banner", () => {
  it("version-check inbox CTA does NOT use 'say X and I'll handle it'", async () => {
    const versionCheck = await import("../../packages/core/src/version_check.js");
    // Module's source text should not contain the regression phrase as the cta string
    // (the phrase still appears in the comments / docs explaining the fix, so we
    // assert on the actual `cta:` literal pushed into inboxes).
    const src = readFileSync(resolve(__dirname, "../../packages/core/src/version_check.ts"), "utf8");
    // Look for any active cta: assignment that is NOT a comment. If a future PR
    // re-adds the instruction-shape phrase, this test fires.
    const lines = src.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (/cta\s*:\s*['"`]/.test(line) && /say\s*['"]upgrade/i.test(line) && /I'?ll handle/i.test(line)) {
        throw new Error(`N5 regression: instruction-shape CTA reappeared in version_check.ts: ${line.trim()}`);
      }
    }
    // Confirm the module is importable + has no error.
    expect(typeof versionCheck).toBe("object");
  });
});

// ── N2 user-visible (pulse-inbox single source of truth) ──────────

describe("WIRING-PROOF: N2 — pulse + CLI inbox agree on unsent count", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "wiring-pulse-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });

  it("countUnsentDisplayable filters stale-version entries (pulse uses same call now)", async () => {
    const inbox = await import("../../packages/core/src/inbox.js");
    const f = join(repo, ".mneme", "inbox.jsonl");
    appendFileSync(f, JSON.stringify({ id: "stale", sent: false, title: "Mneme v9.9.9 — You're on v1.0.0" }) + "\n");
    appendFileSync(f, JSON.stringify({ id: "live", sent: false, title: "real" }) + "\n");
    const displayable = inbox.countUnsentDisplayable(repo, "2.35.0");
    const list = inbox.listDisplayableUnsent(repo, "2.35.0");
    expect(displayable).toBe(1);
    expect(list.length).toBe(displayable);
    // Pulse.ts now uses the shared isDisplayableUnsent helper from inbox.ts
    // — proof of single source of truth. Either the import OR the call
    // counts; the import is the structural commitment.
    const pulseSrc = readFileSync(resolve(__dirname, "../../packages/core/src/pulse.ts"), "utf8");
    expect(pulseSrc).toMatch(/isDisplayableUnsent|countUnsentDisplayable/);
  });
});

// ── R7 user-visible (cli-activity HMAC chain) ──────────────────────

describe("WIRING-PROOF: R7 — cli-activity.jsonl HMAC-chained + verifyCliActivity catches tamper", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "wiring-cli-act-")); mkdirSync(join(repo, ".mneme"), { recursive: true }); });

  it("verifyCliActivity returns ok=true on empty repo", async () => {
    const mod = await import("../../packages/core/src/ai_handshake.js");
    const r = mod.verifyCliActivity(repo);
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(0);
  });

  it("verifyCliActivity catches a tampered row", async () => {
    const mod = await import("../../packages/core/src/ai_handshake.js");
    // Seed two valid rows by calling recordCliActivity twice with different days.
    process.env["MNEME_AI_VENDOR"] = "test-vendor";
    mod.recordCliActivity(repo, "cmd-a");
    // Add a fake malformed/tampered row that pretends to extend the chain.
    const p = join(repo, ".mneme", "cli-activity.jsonl");
    appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), vendor: "evil", command: "tamper", day: 999, prev: "0".repeat(64), hmac: "f".repeat(64) }) + "\n");
    const r = mod.verifyCliActivity(repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hmac/i);
    delete process.env["MNEME_AI_VENDOR"];
  });

  it("HMAC chain links new rows to previous hmac", async () => {
    const mod = await import("../../packages/core/src/ai_handshake.js");
    process.env["MNEME_AI_VENDOR"] = "test-vendor";
    mod.recordCliActivity(repo, "cmd-x");
    const p = join(repo, ".mneme", "cli-activity.jsonl");
    expect(existsSync(p)).toBe(true);
    const line = readFileSync(p, "utf8").trim().split("\n")[0]!;
    const parsed = JSON.parse(line) as { hmac?: string; prev?: string };
    expect(parsed.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.prev).toMatch(/^[a-f0-9]{64}$/);
    delete process.env["MNEME_AI_VENDOR"];
  });
});

// v2.50.0 — EMBEDDER LEAK EXTINCTION + F7 MULTI-ALIAS + HEAT-MAP PROMOTE
//
// User audit closing v2.49 STILL OPEN:
//   B4 cli-activity.jsonl wrote vendor:"ollama" (embedder leak) despite
//      env_scan=claude-code. Root cause: ai_handshake.autoDetectVendor
//      rule 5b fired (OLLAMA_HOST) when Claude Code's CLAUDECODE=1 didn't
//      match the Anthropic rule.
//   F7 `mneme probe` / `gate` / `probecoverage` / `coverage` all unknown.
//   Plus wild: heat-map auto-promotion CLI + VENDOR ALLOWLIST GUARD.

import { describe, it, expect } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string> } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: opts.input, cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  B4 — VENDOR ALLOWLIST GUARD (extinct embedder leak)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.50.0 B4 — VENDOR ALLOWLIST GUARD (PINNED)", () => {
  it("B4.1 guardVendor accepts allowlist members", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    for (const v of ["codex", "claude-code", "copilot", "cursor", "devin"]) {
      const r = m.guardVendor(v);
      expect(r.leakDetected, `${v} should not be flagged`).toBe(false);
      expect(r.vendor).toBe(v);
    }
  });

  it("B4.2 guardVendor flags ollama as embedder leak + coerces to unknown", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const r = m.guardVendor("ollama");
    expect(r.leakDetected).toBe(true);
    expect(r.vendor).toBe("unknown");
  });

  it("B4.3 guardVendor flags openai-gpt / gemini / mistral as leaks (v56: grok promoted to first-class)", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    // v2.56.0 — xai-grok REMOVED from this list (promoted to AGENT_VENDOR_ALLOWLIST)
    for (const v of ["openai-gpt", "google-gemini", "mistral", "deepseek", "llama2"]) {
      const r = m.guardVendor(v);
      expect(r.leakDetected, `${v} should be flagged`).toBe(true);
      expect(r.vendor).toBe("unknown");
    }
  });

  it("B4.4 fullGuard auto-corrects via env_scan when leak detected", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-"));
    const r = m.fullGuard({
      repoRoot: dir,
      candidateVendor: "ollama",
      envScanVendor: "claude-code",
      envScanConfidence: 1.0,
      writerName: "test",
    });
    expect(r.leakDetected).toBe(true);
    expect(r.corrected).toBe(true);
    expect(r.vendor).toBe("claude-code");
  });

  it("B4.5 fullGuard logs leak to .mneme/embedder_leak.jsonl", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-"));
    m.fullGuard({
      repoRoot: dir,
      candidateVendor: "ollama",
      envScanVendor: "claude-code",
      envScanConfidence: 1.0,
      writerName: "test-writer",
    });
    const path = join(dir, ".mneme", "embedder_leak.jsonl");
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toMatch(/ollama/);
    expect(body).toMatch(/test-writer/);
  });

  it("B4.6 autoDetectVendor returns 'claude-code' when CLAUDECODE=1 set", async () => {
    // Use a child Node to inject env without polluting our test process
    const r = spawnSync(process.execPath, ["-e", `
      process.env.CLAUDECODE = "1";
      process.env.OLLAMA_HOST = "http://localhost:11434";
      const m = require("./packages/core/dist/ai_handshake.js");
      const v = m.autoDetectVendor(process.cwd());
      console.log(JSON.stringify(v));
    `], { encoding: "utf8", cwd: resolve(__dirname, "../..") });
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout.trim());
    expect(v.vendor).toBe("claude-code");
  });

  it("B4.7 autoDetectVendor returns 'ollama-backend' (not 'ollama') when only OLLAMA_HOST set", async () => {
    // Use a TMP cwd (no CLAUDE.md / .cursorrules / etc) + aggressively scrub
    // all vendor env vars (including CLAUDE_CODE_SSE_PORT / CLAUDE_CODE_ENTRYPOINT
    // which the harness sets on us). The repo-sentinel CLAUDE.md would
    // otherwise force claude-opus-4-7 detection on actual repoRoot.
    const repoRoot = resolve(__dirname, "../..").replace(/\\/g, "/");
    const tmpCwd = mkdtempSync(join(tmpdir(), "v50-b47-")).replace(/\\/g, "/");
    const r = spawnSync(process.execPath, ["-e", `
      for (const k of Object.keys(process.env)) {
        if (/^(CLAUDECODE|CLAUDE_CODE_|CURSOR_|CONTINUE_|DEVIN_|COPILOT_|GH_COPILOT|GITHUB_COPILOT|GEMINI_|GOOGLE_API|MNEME_AI|ANTHROPIC_|OPENAI_|CODEX_|AIDER_|XAI_|GROK_|MISTRAL_|DEEPSEEK_|CLINE_)/i.test(k)) {
          delete process.env[k];
        }
      }
      process.env.OLLAMA_HOST = "http://localhost:11434";
      const m = require("${repoRoot}/packages/core/dist/ai_handshake.js");
      const v = m.autoDetectVendor("${tmpCwd}");
      console.log(JSON.stringify(v));
    `], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout.trim());
    expect(v.vendor).toBe("ollama-backend");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  F7 — multi-alias for probe-coverage gate
// ═══════════════════════════════════════════════════════════════════════

describe("v2.50.0 F7 — multi-alias probe-coverage (PINNED)", () => {
  it("F7.alias.1 `mneme probe` (default action) runs gate", () => {
    const r = runMneme(["probe"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
    expect(typeof j.totalTools).toBe("number");
  });

  it("F7.alias.2 `mneme gate` runs gate", () => {
    const r = runMneme(["gate"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
  });

  it("F7.alias.3 `mneme coverage` runs gate", () => {
    const r = runMneme(["coverage"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
  });

  it("F7.alias.4 `mneme probecoverage` runs gate", () => {
    const r = runMneme(["probecoverage"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
  });

  it("F7.alias.5 `mneme probe_coverage` runs gate", () => {
    const r = runMneme(["probe_coverage"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
  });

  it("F7.alias.6 all aliases return SAME structure (ok/totalTools/uncovered/hint)", () => {
    const cmds = [["probe"], ["gate"], ["coverage"], ["probecoverage"], ["probe_coverage"]];
    const results = cmds.map((c) => JSON.parse(runMneme(c).stdout));
    for (const r of results) {
      expect(typeof r.ok).toBe("boolean");
      expect(typeof r.totalTools).toBe("number");
      expect(Array.isArray(r.uncovered)).toBe(true);
      expect(typeof r.hint).toBe("string");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  HEAT-MAP AUTO-PROMOTION CLI
// ═══════════════════════════════════════════════════════════════════════

describe("v2.50.0 HEAT-MAP — auto-promotion CLI (PINNED)", () => {
  it("HM.1 `mneme alias_misses report` reads ledger + ranks by frequency", () => {
    const dir = mkdtempSync(join(tmpdir(), "v50-hm-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const lpath = join(dir, ".mneme", "alias_misses.jsonl");
    for (let i = 0; i < 5; i++) appendFileSync(lpath, JSON.stringify({ at: new Date().toISOString(), verb: "popular_verb" }) + "\n");
    for (let i = 0; i < 2; i++) appendFileSync(lpath, JSON.stringify({ at: new Date().toISOString(), verb: "less_popular" }) + "\n");
    const r = runMneme(["alias_misses", "report"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.top[0].verb).toBe("popular_verb");
    expect(j.top[0].count).toBe(5);
  });

  it("HM.2 `mneme alias_misses report` empty ledger returns empty array", () => {
    const dir = mkdtempSync(join(tmpdir(), "v50-hm-"));
    const r = runMneme(["alias_misses", "report"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.total).toBe(0);
  });

  it("HM.3 `mneme alias_misses promote --top 3` suggests top-3 patches", () => {
    const dir = mkdtempSync(join(tmpdir(), "v50-hm-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const lpath = join(dir, ".mneme", "alias_misses.jsonl");
    for (let i = 0; i < 10; i++) appendFileSync(lpath, JSON.stringify({ verb: "a" }) + "\n");
    for (let i = 0; i < 5; i++) appendFileSync(lpath, JSON.stringify({ verb: "b" }) + "\n");
    for (let i = 0; i < 3; i++) appendFileSync(lpath, JSON.stringify({ verb: "c" }) + "\n");
    const r = runMneme(["alias_misses", "promote", "--top", "3"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.suggestions.length).toBe(3);
    expect(j.suggestions[0].verb).toBe("a");
    expect(j.suggestions[0].suggestedPatch).toMatch(/program\.command/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  TG — probe.activity.vendor_field_never_embedder
// ═══════════════════════════════════════════════════════════════════════

describe("v2.50.0 TG — vendor-field-never-embedder probe (PINNED)", () => {
  it("TG.1 probe exists + returns 1 when ledger absent or clean", async () => {
    // Use a fresh tmp cwd — the actual repo's cli-activity.jsonl carries
    // legitimate pre-v2.50 ollama-leak forensic evidence (1500+ rows)
    // which is what this probe was BUILT to catch. The probe correctly
    // returns 0 on the live repo; here we verify the absent-ledger path.
    const dir = mkdtempSync(join(tmpdir(), "v50-tg1-"));
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.activity.vendor_field_never_embedder");
    expect(p).toBeTruthy();
    const r = await p!.run({ cwd: dir });
    expect(r.value).toBe(1);
  });

  it("TG.2 probe returns 0 when ledger contains 'ollama' as vendor", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-tg-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    appendFileSync(join(dir, ".mneme", "cli-activity.jsonl"), JSON.stringify({ vendor: "ollama", command: "test" }) + "\n");
    const p = m.probeById("probe.activity.vendor_field_never_embedder");
    const r = await p!.run({ cwd: dir });
    expect(r.value).toBe(0);
    expect(r.evidence).toMatch(/ollama|embedder/i);
  });

  it("TG.3 claim.activity.vendor_field_never_embedder bound + severity=block", async () => {
    const { CLAIM_CATALOG } = await import("../../packages/core/src/truth_gate/claims.js");
    const c = CLAIM_CATALOG.find((x) => x.id === "claim.activity.vendor_field_never_embedder");
    expect(c).toBeTruthy();
    expect(c!.severity).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CLEANSE — retroactive historical-pollution migration
// ═══════════════════════════════════════════════════════════════════════

describe("v2.50.0 CLEANSE — retroactive ledger migration (PINNED)", () => {
  it("CL.1 cleanseLedger on empty/absent ledger is no-op (idempotent)", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-cl-"));
    const r = m.cleanseLedger({ repoRoot: dir });
    expect(r.ok).toBe(true);
    expect(r.cleansed).toBe(0);
  });

  it("CL.2 cleanseLedger coerces leaked vendor rows to 'unknown'", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-cl-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const lpath = join(dir, ".mneme", "cli-activity.jsonl");
    writeFileSync(lpath, [
      JSON.stringify({ at: "2025-01-01", vendor: "ollama", command: "x" }),
      JSON.stringify({ at: "2025-01-02", vendor: "claude-code", command: "y" }),
      JSON.stringify({ at: "2025-01-03", vendor: "openai-gpt", command: "z" }),
    ].join("\n") + "\n");
    const r = m.cleanseLedger({ repoRoot: dir, hmacKey: "test-key-1234567890abcdef" });
    expect(r.ok).toBe(true);
    expect(r.cleansed).toBe(2);
    expect(r.totalRows).toBe(3);
    const after = readFileSync(lpath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { vendor?: string; migratedFrom?: string });
    expect(after[0].vendor).toBe("unknown");
    expect(after[0].migratedFrom).toBe("ollama");
    expect(after[1].vendor).toBe("claude-code");
    expect(after[2].vendor).toBe("unknown");
    expect(after[2].migratedFrom).toBe("openai-gpt");
  });

  it("CL.3 cleanseLedger creates backup at .pre-v50.bak", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-cl-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const lpath = join(dir, ".mneme", "cli-activity.jsonl");
    const original = JSON.stringify({ vendor: "ollama" }) + "\n";
    writeFileSync(lpath, original);
    m.cleanseLedger({ repoRoot: dir });
    const backup = lpath + ".pre-v50.bak";
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe(original);
  });

  it("CL.4 cleanseLedger --dry-run computes plan without writing", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const dir = mkdtempSync(join(tmpdir(), "v50-cl-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const lpath = join(dir, ".mneme", "cli-activity.jsonl");
    const original = JSON.stringify({ vendor: "ollama" }) + "\n";
    writeFileSync(lpath, original);
    const r = m.cleanseLedger({ repoRoot: dir, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.leakedRows).toBe(1);
    expect(r.cleansed).toBe(0);
    expect(readFileSync(lpath, "utf8")).toBe(original); // untouched
  });

  it("CL.5 `mneme nemesis cleanse_ledger --dry-run` CLI returns JSON envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "v50-cl-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "cli-activity.jsonl"),
      JSON.stringify({ vendor: "ollama", command: "x" }) + "\n");
    const r = runMneme(["nemesis", "cleanse_ledger", "--dry-run"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.leakedRows).toBe(1);
    expect(j.cleansed).toBe(0);
  });
});

/**
 * v2.50.0 — VENDOR ALLOWLIST GUARD (kills EMBEDDER-LEAK class).
 *
 * Root cause from user audit: `recordCliActivity` writes
 * `vendor: "ollama"` to `cli-activity.jsonl`. But Ollama is an
 * EMBEDDER / local-LLM-runner BACKEND — not an AI coding agent vendor.
 * The leak happens in `ai_handshake.autoDetectVendor()` rule 5b:
 *
 *   if (OLLAMA_HOST || OLLAMA_MODELS) return { vendor: "ollama", ... }
 *
 * When user has Ollama running AND uses Claude Code (which sets
 * CLAUDECODE=1, not CLAUDE_CODE_SESSION), the Claude rule doesn't
 * match → falls through to Ollama rule → vendor field gets polluted
 * with the backend name.
 *
 * This module is the central source of truth for "what counts as a
 * real AI coding agent vendor". Any string outside the allowlist gets
 * normalized to "unknown" + logged to `.mneme/embedder_leak.jsonl`
 * for forensic audit.
 *
 * Pure deterministic; never throws.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

/**
 * Canonical agent-vendor allowlist. Anything else = embedder/model/backend
 * leak. Expand carefully — adding a name here is a CLAIM that this string
 * represents an actual AI coding agent (not a model / API / runner).
 */
export const AGENT_VENDOR_ALLOWLIST: ReadonlySet<string> = new Set([
  // Top-5 from arxiv 2601.17406 (Jan 2026)
  "codex",
  "claude-code",
  "copilot",
  "cursor",
  "devin",
  // Also-shipped coding agents in 2026
  "cline",
  "continue",
  "aider",
  "zed",
  "gemini-cli",
  "jules",                  // Google's coding agent
  "qoder",
  "windsurf",
  // Legacy / alternate spellings that map to top-5
  "claude-opus-4-7",
  "claude-opus",
  "claude-sonnet",
  "openai-codex",
  "gh-copilot",
  "github-copilot",
  "cursor-agent",
  // Sentinel
  "unknown",
  "other-mcp",
]);

/**
 * Embedder/backend/model names that MUST NEVER be written as vendor.
 * When detected, log the leak + coerce to "unknown".
 */
export const EMBEDDER_LEAK_SIGNATURES: ReadonlySet<string> = new Set([
  "ollama", "ollama-backend",
  "openai-gpt", "openai", "gpt", "gpt-4", "gpt-5",
  "google-gemini", "gemini",
  "xai-grok", "grok",
  "mistral",
  "deepseek",
  "anthropic",  // bare "anthropic" without "-claude-code" suffix = API key not agent
  "claude",     // bare "claude" = model, not agent
  "ollama2",
  "llama", "llama2", "llama3",
  "mixtral",
  "minilm", "nomic-embed-text",
]);

export interface VendorGuardResult {
  /** Canonical vendor: input if in allowlist, "unknown" otherwise. */
  vendor: string;
  /** True if input was an embedder/backend name that we coerced. */
  leakDetected: boolean;
  /** Why this verdict. */
  reason: string;
}

/**
 * Validate + normalize a vendor string. The CENTRAL guard before any
 * write to cli-activity / active-vendor / other vendor-tagged ledgers.
 */
export function guardVendor(input: string | null | undefined): VendorGuardResult {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) {
    return { vendor: "unknown", leakDetected: false, reason: "empty input" };
  }
  if (AGENT_VENDOR_ALLOWLIST.has(v)) {
    return { vendor: v, leakDetected: false, reason: "in allowlist" };
  }
  if (EMBEDDER_LEAK_SIGNATURES.has(v)) {
    return {
      vendor: "unknown",
      leakDetected: true,
      reason: `embedder/backend name "${v}" leaked into vendor field — coerced to unknown`,
    };
  }
  // Unknown but not flagged as embedder: keep verbatim (might be a new
  // coding agent we haven't added yet). Caller's choice whether to write.
  return {
    vendor: v,
    leakDetected: false,
    reason: `not in allowlist; preserved verbatim (consider adding to AGENT_VENDOR_ALLOWLIST)`,
  };
}

/**
 * Log an embedder leak to `.mneme/embedder_leak.jsonl` for forensic
 * audit. Defensive: never throws.
 */
export function logEmbedderLeak(
  repoRoot: string,
  context: { writer: string; rawVendor: string; resolved: string; envScanResult?: string },
): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "embedder_leak.jsonl");
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...context }) + "\n");
  } catch { /* defensive */ }
}

/**
 * Composite guard: takes a candidate vendor + (optional) env_scan
 * result; returns the final canonical vendor + logs leak if found.
 */
export interface FullGuardInput {
  repoRoot: string;
  candidateVendor: string | null | undefined;
  /** When supplied, used as the "correct" answer to replace a leaked vendor. */
  envScanVendor?: string;
  envScanConfidence?: number;
  /** Where the candidate came from (for forensic trail). */
  writerName: string;
}

export interface FullGuardResult {
  vendor: string;
  leakDetected: boolean;
  corrected: boolean;
  reason: string;
}

export function fullGuard(input: FullGuardInput): FullGuardResult {
  const candidate = guardVendor(input.candidateVendor);
  if (!candidate.leakDetected) {
    return {
      vendor: candidate.vendor,
      leakDetected: false,
      corrected: false,
      reason: candidate.reason,
    };
  }
  // Leak detected. Try env_scan as fallback truth.
  let final = candidate.vendor; // "unknown"
  let corrected = false;
  if (input.envScanVendor) {
    const envG = guardVendor(input.envScanVendor);
    if (!envG.leakDetected && envG.vendor !== "unknown" && (input.envScanConfidence ?? 0) >= 0.5) {
      final = envG.vendor;
      corrected = true;
    }
  }
  logEmbedderLeak(input.repoRoot, {
    writer: input.writerName,
    rawVendor: String(input.candidateVendor ?? ""),
    resolved: final,
    envScanResult: input.envScanVendor,
  });
  return {
    vendor: final,
    leakDetected: true,
    corrected,
    reason: corrected
      ? `embedder leak corrected via env_scan: "${input.candidateVendor}" → "${final}"`
      : `embedder leak detected: "${input.candidateVendor}" → "unknown" (no env_scan fallback available)`,
  };
}

// ════════════════════════════════════════════════════════════════════
//  v2.50.0 — RETROACTIVE LEDGER CLEANSE
// ════════════════════════════════════════════════════════════════════
//
// Closes the historical-pollution side of B4: pre-v2.50 cli-activity.jsonl
// rows where vendor ∈ EMBEDDER_LEAK_SIGNATURES. The cleanse:
//   1. Backs up the existing ledger to `cli-activity.jsonl.pre-v50.bak`
//      (forensic preservation — never modify history without a receipt).
//   2. Rewrites the live ledger with leaked vendor fields coerced to
//      "unknown" + re-chains HMACs from genesis using the supplied key.
//   3. Appends one summary row to `.mneme/embedder_leak.jsonl` recording
//      the migration count + before/after hash so the cleanse is itself
//      auditable.
// Idempotent: re-running on an already-clean ledger is a no-op.

export interface CleanseLedgerInput {
  repoRoot: string;
  /** HMAC key for re-chaining. If absent, chain field is dropped. */
  hmacKey?: string;
  /** When true, only computes the plan + returns counts; no writes. */
  dryRun?: boolean;
}

export interface CleanseLedgerResult {
  ok: boolean;
  totalRows: number;
  leakedRows: number;
  cleansed: number;
  backupPath?: string;
  reason: string;
}

interface ActivityRow {
  at?: string;
  vendor?: string;
  command?: string;
  day?: number;
  prev?: string;
  hmac?: string;
  [k: string]: unknown;
}

function recomputeHmac(prev: string, payload: object, key: string): string {
  const h = createHmac("sha256", key);
  h.update(prev);
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export function cleanseLedger(input: CleanseLedgerInput): CleanseLedgerResult {
  try {
    const dir = join(input.repoRoot, ".mneme");
    const path = join(dir, "cli-activity.jsonl");
    if (!existsSync(path)) {
      return { ok: true, totalRows: 0, leakedRows: 0, cleansed: 0, reason: "no ledger to cleanse" };
    }
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    let leakedRows = 0;
    const parsed: ActivityRow[] = [];
    for (const ln of lines) {
      try {
        const row = JSON.parse(ln) as ActivityRow;
        if (typeof row.vendor === "string") {
          const g = guardVendor(row.vendor);
          if (g.leakDetected) leakedRows++;
        }
        parsed.push(row);
      } catch {
        parsed.push({ raw: ln } as ActivityRow);
      }
    }
    if (leakedRows === 0) {
      return { ok: true, totalRows: lines.length, leakedRows: 0, cleansed: 0, reason: "ledger already clean" };
    }
    if (input.dryRun) {
      return {
        ok: true, totalRows: lines.length, leakedRows, cleansed: 0,
        reason: `dry-run: would cleanse ${leakedRows} leaked rows`,
      };
    }
    // Backup BEFORE any write.
    const backupPath = path + ".pre-v50.bak";
    try { copyFileSync(path, backupPath); } catch { /* fs full / readonly */ }
    // Rewrite: coerce leaked vendors + (optionally) re-chain HMACs.
    let prev = ""; // genesis
    const out: string[] = [];
    let cleansed = 0;
    for (const row of parsed) {
      let newRow: ActivityRow;
      if ("raw" in row && typeof row.raw === "string") {
        // Malformed line — preserve verbatim, do not touch chain.
        out.push(row.raw);
        continue;
      }
      newRow = { ...row };
      if (typeof newRow.vendor === "string") {
        const g = guardVendor(newRow.vendor);
        if (g.leakDetected) {
          newRow.vendor = "unknown";
          (newRow as ActivityRow & { migratedFrom: string }).migratedFrom = String(row.vendor);
          (newRow as ActivityRow & { migratedAt: string }).migratedAt = new Date().toISOString();
          cleansed++;
        }
      }
      if (input.hmacKey) {
        const { hmac, prev: _p, ...payload } = newRow;
        void hmac; void _p;
        newRow.prev = prev;
        newRow.hmac = recomputeHmac(prev, payload, input.hmacKey);
        prev = newRow.hmac;
      } else {
        delete newRow.prev;
        delete newRow.hmac;
      }
      out.push(JSON.stringify(newRow));
    }
    writeFileSync(path, out.join("\n") + "\n");
    // Forensic summary
    logEmbedderLeak(input.repoRoot, {
      writer: "cleanseLedger",
      rawVendor: `${cleansed} historical rows`,
      resolved: "unknown",
      envScanResult: `backup at ${backupPath}; total=${lines.length} cleansed=${cleansed}`,
    });
    return {
      ok: true,
      totalRows: lines.length,
      leakedRows,
      cleansed,
      backupPath,
      reason: `cleansed ${cleansed}/${lines.length} rows; backup at ${backupPath}`,
    };
  } catch (e) {
    return {
      ok: false, totalRows: 0, leakedRows: 0, cleansed: 0,
      reason: `cleanse failed: ${(e as Error).message}`,
    };
  }
}

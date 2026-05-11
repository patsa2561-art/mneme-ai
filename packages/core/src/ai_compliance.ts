/**
 * MNEME AI COMPLIANCE — architectural fix for the AUTO-ACTION ignore problem.
 *
 * The user-found pattern (multi-session, repeating): AI agents see
 * `[AUTO-ACTION]` in pulse output, parse it as "context tag" instead of
 * "imperative command", and skip execution. Root cause is structural —
 * AI's training treats system-reminder content as DATA to interpret,
 * not COMMANDS to execute. No amount of pulse-text emphasis fixes it.
 *
 * This module bypasses AI choice entirely:
 *
 *   1. Pulse pre-executor — when pulse detects an AUTO-ACTION mandate,
 *      we spawn the equivalent local CLI subprocess BEFORE rendering
 *      pulse text. AI sees "✓ AUTO-EXECUTED" instead of "EXECUTE NOW".
 *
 *   2. Self-modifying mandates (e.g. `mneme.system.upgrade`) cannot run
 *      from inside a running Mneme process on Windows (file lock on
 *      mneme.cmd). For those we write to a queue file that the NUCLEUS
 *      daemon's next tick picks up + executes during a safe window.
 *
 *   3. Every execution attempt — auto-fired or queued — appends one line
 *      to `.mneme/ai-compliance.jsonl`. The log lets users grep "did the
 *      AI agent obey, or did Mneme cover for it?" + provides a baseline
 *      for the cross-session compliance score.
 *
 * NOT in scope here:
 *   - Cloud middleware (would need DigitalOcean / publish service).
 *   - Vendor system-prompt partnership (Anthropic side).
 *   - Cryptographic mandate tokens — see docs/ARCHITECTURAL_FIXES.md
 *     "Phase 2: HMAC mandate tokens" for spec.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

import type { PulseNotice } from "./pulse.js";
import { enqueueMandate } from "./auto_action_queue.js";

const COMPLIANCE_LOG = ".mneme/ai-compliance.jsonl";
const REPLAY_SECRET = ".mneme/replay-secret.bin";
const EXEC_TIMEOUT_MS = 8000;
const TOKEN_LENGTH = 16;       // first 16 hex chars of HMAC = 64 bits collision space

/** Tools whose effects ARE safe to execute from inside the pulse hook
 *  (no file-lock on the running Mneme binary, no destructive prompts).
 *  Maps MCP tool name → local CLI invocation. */
const SAFE_INLINE_MANDATES: Record<string, string[]> = {
  "mneme.antivirus.cert.benchmark": ["antivirus", "benchmark"],
  "mneme.antivirus.lab": ["antivirus", "lab"],
  "mneme.evolve.scan": ["evolve", "scan"],
  "mneme.evolve.pass": ["evolve", "pass"],
  "mneme.nucleus.dna": ["nucleus", "dna"],
  "mneme.precog.dream": ["precog", "dream"],
};

/** Tools that mutate the Mneme binary itself or the global install — NOT
 *  safe to run from inside a Mneme subprocess. We queue these for the
 *  daemon to pick up at a safe window. */
const QUEUED_MANDATES: Set<string> = new Set([
  "mneme.system.upgrade",
]);

export interface ComplianceEntry {
  ts: string;
  mandate: string;
  args: Record<string, unknown>;
  /** v1.41.0 Phase 2 — HMAC-signed token (16 hex chars). */
  token?: string;
  executor: "pulse-pre-executor" | "daemon-queue" | "ai-agent";
  outcome: "executed" | "queued" | "skipped" | "failed";
  durationMs?: number;
  error?: string;
  /** Free-text rationale when outcome=skipped (e.g. "unsafe inline"). */
  note?: string;
}

export function readComplianceLog(repoRoot: string, limit = 200): ComplianceEntry[] {
  const p = join(repoRoot, COMPLIANCE_LOG);
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const entries = lines.map((l) => {
      try { return JSON.parse(l) as ComplianceEntry; } catch { return null; }
    }).filter((x): x is ComplianceEntry => x !== null);
    return entries.slice(-limit);
  } catch {
    return [];
  }
}

export interface ComplianceStats {
  total: number;
  byOutcome: Record<string, number>;
  byMandate: Record<string, { total: number; executed: number; queued: number; skipped: number; failed: number }>;
  byExecutor: Record<string, number>;
  /** Aggregate compliance rate: executed / (executed + skipped + failed) */
  inlineComplianceRate: number;
}

export function computeComplianceStats(entries: ComplianceEntry[]): ComplianceStats {
  const stats: ComplianceStats = {
    total: entries.length,
    byOutcome: {},
    byMandate: {},
    byExecutor: {},
    inlineComplianceRate: 0,
  };
  for (const e of entries) {
    stats.byOutcome[e.outcome] = (stats.byOutcome[e.outcome] ?? 0) + 1;
    stats.byExecutor[e.executor] = (stats.byExecutor[e.executor] ?? 0) + 1;
    if (!stats.byMandate[e.mandate]) stats.byMandate[e.mandate] = { total: 0, executed: 0, queued: 0, skipped: 0, failed: 0 };
    const m = stats.byMandate[e.mandate]!;
    m.total++;
    m[e.outcome]++;
  }
  const inline = (stats.byOutcome["executed"] ?? 0) + (stats.byOutcome["skipped"] ?? 0) + (stats.byOutcome["failed"] ?? 0);
  stats.inlineComplianceRate = inline === 0 ? 1 : (stats.byOutcome["executed"] ?? 0) / inline;
  return stats;
}

export interface PreExecutionResult {
  tool: string;
  outcome: "executed" | "queued" | "skipped" | "failed";
  summary: string;
  durationMs: number;
}

function ensureMnemeDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function logCompliance(repoRoot: string, entry: ComplianceEntry): void {
  try {
    ensureMnemeDir(repoRoot);
    appendFileSync(join(repoRoot, COMPLIANCE_LOG), JSON.stringify(entry) + "\n");
  } catch {
    // Compliance log failure must never break the pulse path.
  }
}

/** v1.41.0 Phase 2 — HMAC-signed mandate token. Reuses the per-repo
 *  replay secret (created on demand if missing). The token lets later
 *  audits (and a future cloud middleware) verify that a compliance entry
 *  actually corresponds to a mandate Mneme issued, not an injection.
 *
 *  We expose 16 hex chars (64 bits). Collision space is far more than
 *  enough for the lifetime of a single repo's mandate stream and keeps
 *  the pulse line short. */
function readOrCreateSecret(repoRoot: string): Buffer {
  ensureMnemeDir(repoRoot);
  const p = join(repoRoot, REPLAY_SECRET);
  if (existsSync(p)) {
    try { return readFileSync(p); } catch { /* fall through and regenerate */ }
  }
  const fresh = randomBytes(32);
  try { writeFileSync(p, fresh, { mode: 0o600 }); } catch { /* compliance must never crash on FS error */ }
  return fresh;
}

export function signMandate(repoRoot: string, mandate: string, args: Record<string, unknown>): string {
  const secret = readOrCreateSecret(repoRoot);
  const payload = mandate + "::" + JSON.stringify(args);
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, TOKEN_LENGTH);
}

export function verifyMandate(repoRoot: string, mandate: string, args: Record<string, unknown>, token: string): boolean {
  return signMandate(repoRoot, mandate, args) === token;
}

function spawnInline(args: string[], repoRoot: string): Promise<{ ok: boolean; durationMs: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("mneme", args, {
      cwd: repoRoot,
      detached: false,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, durationMs: Date.now() - start, error });
    };
    const timeout = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(false, "exec-timeout");
    }, EXEC_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timeout); finish(false, (e as Error).message); });
    child.on("exit", (code) => { clearTimeout(timeout); finish(code === 0, code !== 0 ? `exit-${code}` : undefined); });
  });
}

/** Walk pulse notices, pre-execute every AUTO-ACTION mandate we know how
 *  to handle locally. Returns one result per mandate so the caller can
 *  rewrite the pulse text from "EXECUTE NOW" → "✓ AUTO-EXECUTED". */
export async function preExecuteAutoActions(
  notices: PulseNotice[],
  repoRoot: string,
): Promise<PreExecutionResult[]> {
  const out: PreExecutionResult[] = [];

  for (const n of notices) {
    if (!n.autoAction) continue;
    const tool = n.autoAction.tool;
    const args = n.autoAction.args ?? {};
    const ts = new Date().toISOString();

    if (QUEUED_MANDATES.has(tool)) {
      try {
        enqueueMandate(repoRoot, tool, args);
        const token = signMandate(repoRoot, tool, args);
        logCompliance(repoRoot, { ts, mandate: tool, args, token, executor: "pulse-pre-executor", outcome: "queued", note: "self-modifying — daemon will execute at safe window" });
        out.push({ tool, outcome: "queued", summary: "queued for daemon", durationMs: 0 });
      } catch (e) {
        logCompliance(repoRoot, { ts, mandate: tool, args, executor: "pulse-pre-executor", outcome: "failed", error: (e as Error).message });
        out.push({ tool, outcome: "failed", summary: (e as Error).message, durationMs: 0 });
      }
      continue;
    }

    const cli = SAFE_INLINE_MANDATES[tool];
    if (!cli) {
      logCompliance(repoRoot, { ts, mandate: tool, args, executor: "pulse-pre-executor", outcome: "skipped", note: "no inline mapping — falls back to AI-agent path" });
      out.push({ tool, outcome: "skipped", summary: "no inline mapping (AI agent must execute)", durationMs: 0 });
      continue;
    }

    const result = await spawnInline(cli, repoRoot);
    const token = signMandate(repoRoot, tool, args);
    logCompliance(repoRoot, { ts, mandate: tool, args, token, executor: "pulse-pre-executor", outcome: result.ok ? "executed" : "failed", durationMs: result.durationMs, error: result.error });
    out.push({ tool, outcome: result.ok ? "executed" : "failed", summary: result.ok ? `done in ${result.durationMs}ms` : (result.error ?? "unknown"), durationMs: result.durationMs });
  }

  return out;
}

/** Mutate the notices array so renderPulse shows the post-execution
 *  state. Designed to be called immediately after preExecuteAutoActions. */
export function rewriteNoticesPostExecution(
  notices: PulseNotice[],
  results: PreExecutionResult[],
): void {
  for (const r of results) {
    const n = notices.find((x) => x.autoAction?.tool === r.tool);
    if (!n) continue;
    if (r.outcome === "executed") {
      n.text = `✓ AUTO-EXECUTED (pulse pre-executor): ${r.tool} → ${r.summary}`;
      n.level = "info";
      n.autoAction = undefined;
    } else if (r.outcome === "queued") {
      n.text = `⏳ QUEUED (daemon will execute at safe window): ${r.tool}`;
      n.level = "info";
      n.autoAction = undefined;
    } else if (r.outcome === "failed") {
      n.text = `⚠ AUTO-EXECUTION FAILED: ${r.tool} → ${r.summary} — falling back to AI-agent path. Original mandate preserved below.`;
      n.level = "warning";
      // keep autoAction so AI sees the EXECUTE NOW fallback
    }
    // outcome="skipped" — leave the mandate intact for AI fallback
  }
}

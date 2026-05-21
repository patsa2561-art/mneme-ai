/**
 * v2.20.2 — APOPTOSIS NETWORK.
 *
 * Biological apoptosis = "a cell becomes harmful → triggers its own
 * destruction so the organism survives." Mneme already had this for
 * CLAIMS (mneme.retirement.detect, since v1.65). v2.20.2 extends it
 * to PATTERNS.
 *
 * When a code-pattern / decision-pattern / behaviour-pattern has
 * failed in N independent repos × M distinct vendors × T weeks:
 *
 *   1. Pattern is marked APOPTOTIC (organism-level harmful).
 *   2. Every AI agent connected to Mneme that ATTEMPTS the pattern
 *      gets a structural REFUSE verdict at the soul.check layer.
 *      The refusal carries signed lineage: "747 repos tried, 681
 *      failed in <4 weeks, here's the fingerprint."
 *   3. The pattern is auto-vaccinated into the antivirus bank so
 *      variants refute in 0 ms via simhash.
 *   4. Counter-patterns — extracted from the (smaller) set of repos
 *      that attempted the pattern AND found a workaround that
 *      survived — are recorded as the recommended replacement.
 *
 * The result is an IMMUNE SYSTEM FOR AI-WRITTEN CODE.  Not "AI
 * remembers its mistakes."  "The swarm collectively refuses to repeat."
 *
 * Why competitors can't build this in <18 months:
 *   • cross-repo experience pool — needs Mneme's super-nova fabric
 *   • HMAC audit chain — needs apostille + soul chain
 *   • multi-vendor reach — needs Mneme's existing reach across
 *     Claude / GPT / Gemini / Cursor / Cline / Codex / Antigravity 2.0
 *   • refuse-at-source primitive — needs Mneme's SOUL + Whistleblower
 *     + Polygraph + Antivirus
 *   • local-first + opt-in federation substrate — needs Mneme's
 *     existing design
 *
 * Build effort here is COMPOSITION — every primitive already exists.
 *
 * Storage layout (.mneme/apoptosis/):
 *   patterns.jsonl       — every pattern attempted + outcome (per repo)
 *   federation.jsonl     — incoming aggregated rows from peer repos (opt-in)
 *   counter_patterns.jsonl — surviving workarounds extracted
 *   verdicts.json        — cached per-pattern verdicts (refreshed on tick)
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { withSuperNova } from "../super_nova/index.js";

const DIR = ".mneme/apoptosis";
const PATTERNS = "patterns.jsonl";
const FEDERATION = "federation.jsonl";
const COUNTER = "counter_patterns.jsonl";
const VERDICTS = "verdicts.json";
const KEY = "apoptosis.key";

export type PatternOutcome = "success" | "failure" | "partial";
export type ApoptosisStage = "HEALTHY" | "INFLAMED" | "NECROTIC" | "APOPTOTIC";

export interface PatternRecord {
  v: 1;
  /** Stable fingerprint of the pattern (sha256 of a canonical token form). */
  fingerprint: string;
  /** One-line human-readable description for logs / dashboards. */
  description: string;
  /** Anonymous repo id (sha256 of repoRoot + first commit SHA). */
  repoId: string;
  /** Vendor that attempted the pattern (claude / gpt / gemini / cursor / ...). */
  vendor: string;
  /** Outcome — success / failure / partial. */
  outcome: PatternOutcome;
  /** Failure class from super-nova taxonomy when outcome === "failure". */
  failureClass?: string;
  ts: string;
  /** HMAC sig over the canonical row. */
  sig: string;
}

export interface ApoptosisVerdict {
  fingerprint: string;
  stage: ApoptosisStage;
  /** Total attempts across all repos. */
  attemptCount: number;
  /** Failures across all repos. */
  failureCount: number;
  /** Distinct repos that attempted. */
  distinctRepos: number;
  /** Distinct vendors that attempted. */
  distinctVendors: number;
  /** Age in weeks since first attempt. */
  ageWeeks: number;
  /** Surviving counter-patterns (when stage = NECROTIC / APOPTOTIC). */
  counterPatterns: Array<{ fingerprint: string; description: string; successCount: number }>;
  /** HMAC-signed lineage the receiving AI can verify. */
  lineageSig: string;
}

/** Thresholds for verdict stage transitions. Conservative on purpose;
 *  refusing a pattern incorrectly is more harmful than over-warning. */
export const APOPTOSIS_THRESHOLDS = {
  /** INFLAMED → at least this many attempts seen. */
  inflamedMinAttempts: 3,
  /** NECROTIC → failure rate this high. */
  necroticFailureRate: 0.5,
  /** APOPTOTIC requires ALL of these. */
  apoptoticMinFailureCount: 5,
  apoptoticMinDistinctRepos: 3,
  apoptoticMinDistinctVendors: 2,
  apoptoticMinAgeWeeks: 1,
  apoptoticMinFailureRate: 0.7,
};

// ─── STORAGE ───────────────────────────────────────────────────────────

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function ensureKey(repoRoot: string): string {
  const d = ensureDir(repoRoot);
  const p = join(d, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

/** Hash an arbitrary pattern token-string into a stable fingerprint. */
export function fingerprint(patternTokens: string): string {
  return createHash("sha256").update(patternTokens.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/** Anonymous repo id — sha256(repoRoot + first commit SHA, when available). */
export function anonymousRepoId(repoRoot: string): string {
  let extra = "";
  try {
    const { execSync } = require("node:child_process");
    extra = execSync("git rev-list --max-parents=0 HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch { /* */ }
  return createHash("sha256").update(repoRoot + "|" + extra).digest("hex").slice(0, 16);
}

function loadPatterns(repoRoot: string): PatternRecord[] {
  const p = join(repoRoot, DIR, PATTERNS);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as PatternRecord; } catch { return null; } }).filter((r): r is PatternRecord => !!r);
  } catch { return []; }
}

function loadFederation(repoRoot: string): PatternRecord[] {
  const p = join(repoRoot, DIR, FEDERATION);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as PatternRecord; } catch { return null; } }).filter((r): r is PatternRecord => !!r);
  } catch { return []; }
}

// ─── RECORD ─────────────────────────────────────────────────────────────

export interface RecordOptions {
  patternTokens: string;
  description: string;
  vendor: string;
  outcome: PatternOutcome;
  failureClass?: string;
}

/** Record one pattern attempt outcome.  Called by the super-nova
 *  auto-observer when a noteworthy verb completes (or by callers
 *  explicitly when they know they're attempting a categorised pattern). */
export async function record(repoRoot: string, opts: RecordOptions): Promise<PatternRecord> {
  return withSuperNova(
    { verb: "mneme.apoptosis.record", surface: "lib", repoRoot, vendor: opts.vendor },
    async () => {
      const key = ensureKey(repoRoot);
      const fp = fingerprint(opts.patternTokens);
      const ts = new Date().toISOString();
      const repoId = anonymousRepoId(repoRoot);
      const payload: Omit<PatternRecord, "sig"> = {
        v: 1, fingerprint: fp, description: opts.description,
        repoId, vendor: opts.vendor, outcome: opts.outcome,
        failureClass: opts.failureClass, ts,
      };
      const canonical = `${payload.v}|${payload.fingerprint}|${payload.repoId}|${payload.vendor}|${payload.outcome}|${payload.failureClass ?? ""}|${payload.ts}`;
      const sig = sign(canonical, key);
      const rec: PatternRecord = { ...payload, sig };
      appendFileSync(join(ensureDir(repoRoot), PATTERNS), JSON.stringify(rec) + "\n", "utf8");
      return rec;
    },
    { tags: ["apoptosis", "record"] },
  );
}

// ─── DIAGNOSE ──────────────────────────────────────────────────────────

/** Diagnose the stage of a single pattern. Pure read; safe to call
 *  cheaply.  Combines local + federation rows. */
export async function diagnose(repoRoot: string, patternTokens: string): Promise<ApoptosisVerdict> {
  return withSuperNova(
    { verb: "mneme.apoptosis.diagnose", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const fp = fingerprint(patternTokens);
      const local = loadPatterns(repoRoot).filter((r) => r.fingerprint === fp);
      const fed = loadFederation(repoRoot).filter((r) => r.fingerprint === fp);
      const all = [...local, ...fed];
      const failures = all.filter((r) => r.outcome === "failure");
      const repos = new Set(all.map((r) => r.repoId));
      const vendors = new Set(all.map((r) => r.vendor));
      const ageWeeks = all.length > 0
        ? (Date.now() - new Date(all.map((r) => r.ts).sort()[0]!).getTime()) / (1000 * 60 * 60 * 24 * 7)
        : 0;
      const failureRate = all.length > 0 ? failures.length / all.length : 0;

      // Stage decision.
      let stage: ApoptosisStage = "HEALTHY";
      if (all.length >= APOPTOSIS_THRESHOLDS.inflamedMinAttempts) stage = "INFLAMED";
      if (failureRate >= APOPTOSIS_THRESHOLDS.necroticFailureRate && all.length >= APOPTOSIS_THRESHOLDS.inflamedMinAttempts) stage = "NECROTIC";
      if (
        failures.length >= APOPTOSIS_THRESHOLDS.apoptoticMinFailureCount &&
        repos.size >= APOPTOSIS_THRESHOLDS.apoptoticMinDistinctRepos &&
        vendors.size >= APOPTOSIS_THRESHOLDS.apoptoticMinDistinctVendors &&
        ageWeeks >= APOPTOSIS_THRESHOLDS.apoptoticMinAgeWeeks &&
        failureRate >= APOPTOSIS_THRESHOLDS.apoptoticMinFailureRate
      ) stage = "APOPTOTIC";

      // Counter-patterns (only for NECROTIC / APOPTOTIC).
      let counterPatterns: ApoptosisVerdict["counterPatterns"] = [];
      if (stage === "NECROTIC" || stage === "APOPTOTIC") {
        counterPatterns = loadCounterPatterns(repoRoot, fp);
      }

      const key = ensureKey(repoRoot);
      const lineageCanonical = `${fp}|${stage}|${all.length}|${failures.length}|${repos.size}|${vendors.size}|${ageWeeks.toFixed(2)}`;
      const lineageSig = sign(lineageCanonical, key);

      return {
        fingerprint: fp,
        stage,
        attemptCount: all.length,
        failureCount: failures.length,
        distinctRepos: repos.size,
        distinctVendors: vendors.size,
        ageWeeks: Number(ageWeeks.toFixed(2)),
        counterPatterns,
        lineageSig,
      };
    },
    { tags: ["apoptosis", "diagnose"] },
  );
}

interface CounterPatternRecord {
  v: 1;
  failedFingerprint: string;
  successFingerprint: string;
  description: string;
  successCount: number;
}

function loadCounterPatterns(repoRoot: string, failedFp: string): ApoptosisVerdict["counterPatterns"] {
  const p = join(repoRoot, DIR, COUNTER);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => {
      try { return JSON.parse(l) as CounterPatternRecord; } catch { return null; }
    }).filter((r): r is CounterPatternRecord => !!r && r.failedFingerprint === failedFp).map((r) => ({
      fingerprint: r.successFingerprint,
      description: r.description,
      successCount: r.successCount,
    }));
  } catch { return []; }
}

export function recordCounterPattern(repoRoot: string, opts: {
  failedTokens: string;
  successTokens: string;
  description: string;
}): void {
  const failedFp = fingerprint(opts.failedTokens);
  const successFp = fingerprint(opts.successTokens);
  const rec: CounterPatternRecord = {
    v: 1,
    failedFingerprint: failedFp,
    successFingerprint: successFp,
    description: opts.description,
    successCount: 1,
  };
  const dir = ensureDir(repoRoot);
  appendFileSync(join(dir, COUNTER), JSON.stringify(rec) + "\n", "utf8");
}

// ─── CHECK (refuse-at-source) ──────────────────────────────────────────

export interface PatternCheckResult {
  fingerprint: string;
  verdict: ApoptosisStage;
  refuse: boolean;
  /** Plain-English explanation the AI agent surfaces to the user. */
  reason: string;
  /** Lineage signature the receiver can verify. */
  lineageSig: string;
  /** Suggested counter-pattern, when available. */
  suggestion: ApoptosisVerdict["counterPatterns"][number] | null;
}

/** The headline: refuse-at-source check. Wire into soul.check so any
 *  AI plan matching an APOPTOTIC pattern is structurally refused. */
export async function checkPattern(repoRoot: string, patternTokens: string): Promise<PatternCheckResult> {
  const v = await diagnose(repoRoot, patternTokens);
  const refuse = v.stage === "APOPTOTIC";
  let reason = "";
  if (refuse) {
    reason = `APOPTOSIS NETWORK refuses this pattern. ${v.attemptCount} attempts across ${v.distinctRepos} repos and ${v.distinctVendors} vendors over ${v.ageWeeks.toFixed(1)} weeks; ${v.failureCount}/${v.attemptCount} failed.`;
  } else if (v.stage === "NECROTIC") {
    reason = `APOPTOSIS NETWORK warns: pattern is necrotic (${v.failureCount}/${v.attemptCount} failed across ${v.distinctRepos} repos). Proceed with caution; consider counter-patterns below.`;
  } else if (v.stage === "INFLAMED") {
    reason = `APOPTOSIS NETWORK: pattern is inflamed (only ${v.attemptCount} attempts so far; ${v.failureCount} failures). Not yet refused.`;
  } else {
    reason = `APOPTOSIS NETWORK: pattern healthy or not enough data.`;
  }
  return {
    fingerprint: v.fingerprint,
    verdict: v.stage,
    refuse,
    reason,
    lineageSig: v.lineageSig,
    suggestion: v.counterPatterns[0] ?? null,
  };
}

// ─── FEDERATION (opt-in cross-repo aggregation) ────────────────────────

/** Export local apoptosis rows for federation. Caller sends to peer
 *  Mneme instances who can `importFederation` them. */
export function exportFederationRows(repoRoot: string): PatternRecord[] {
  return loadPatterns(repoRoot);
}

/** Import a peer's exported rows. Idempotent — duplicates dropped by
 *  composite-key. */
export function importFederation(repoRoot: string, rows: PatternRecord[]): { imported: number; skipped: number } {
  const dir = ensureDir(repoRoot);
  const existing = new Set(loadFederation(repoRoot).map((r) => `${r.repoId}|${r.fingerprint}|${r.ts}`));
  let imported = 0, skipped = 0;
  for (const r of rows) {
    const k = `${r.repoId}|${r.fingerprint}|${r.ts}`;
    if (existing.has(k)) { skipped++; continue; }
    existing.add(k);
    appendFileSync(join(dir, FEDERATION), JSON.stringify(r) + "\n", "utf8");
    imported++;
  }
  return { imported, skipped };
}

// ─── HUMAN-READABLE OUTPUT ─────────────────────────────────────────────

export function formatVerdict(v: ApoptosisVerdict): string {
  const lines: string[] = [];
  const badge = v.stage === "APOPTOTIC" ? "💀"
              : v.stage === "NECROTIC" ? "⚠"
              : v.stage === "INFLAMED" ? "⚡"
              : "✓";
  lines.push(`🧬 MNEME APOPTOSIS NETWORK — ${badge} ${v.stage}`);
  lines.push("");
  lines.push(`  Pattern:        ${v.fingerprint.slice(0, 16)}…`);
  lines.push(`  Attempts:       ${v.attemptCount}`);
  lines.push(`  Failures:       ${v.failureCount}  (${v.attemptCount > 0 ? ((v.failureCount / v.attemptCount) * 100).toFixed(0) : 0}%)`);
  lines.push(`  Distinct repos: ${v.distinctRepos}`);
  lines.push(`  Distinct vendors: ${v.distinctVendors}`);
  lines.push(`  Age:            ${v.ageWeeks.toFixed(2)} weeks`);
  lines.push(`  Lineage sig:    ${v.lineageSig}`);
  if (v.counterPatterns.length > 0) {
    lines.push("");
    lines.push(`  Surviving counter-patterns:`);
    for (const c of v.counterPatterns.slice(0, 3)) {
      lines.push(`    • ${c.description}  (${c.successCount} success(es))`);
    }
  }
  return lines.join("\n");
}

export function formatCheckResult(r: PatternCheckResult): string {
  const lines: string[] = [];
  const verb = r.refuse ? "⛔ REFUSED" : r.verdict === "NECROTIC" ? "⚠ CAUTION" : r.verdict === "INFLAMED" ? "⚡ INFLAMED" : "✓ OK";
  lines.push(`🧬 APOPTOSIS NETWORK — ${verb}`);
  lines.push("");
  lines.push(`  Reason: ${r.reason}`);
  lines.push(`  Lineage sig: ${r.lineageSig}`);
  if (r.suggestion) {
    lines.push("");
    lines.push(`  Recommended counter-pattern: ${r.suggestion.description}`);
  }
  return lines.join("\n");
}

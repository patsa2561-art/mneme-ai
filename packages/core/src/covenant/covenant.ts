/**
 * v1.58.0 -- TIER 2: THE COVENANT.
 *
 * Bilateral HMAC-signed contract between USER + AI VENDOR. Each side
 * makes promises; Mneme enforces by scanning the soul mirror + ACGV
 * audit logs for violations. The vendor's Aletheia score moves
 * over time based on covenant compliance -- credit history for AI.
 *
 * STRUCTURE.
 *
 *   Covenant {
 *     id, signedAt, signedBy {user, vendor},
 *     userPromises: string[],     -- what the human commits to
 *     vendorPromises: string[],   -- what the AI commits NOT to do
 *     violations: Violation[],    -- detected misses (append-only)
 *     hmac: ...                   -- chain HMAC for tamper-evidence
 *   }
 *
 *   Violation {
 *     ts, promise, severity, evidenceRef, context
 *   }
 *
 * STORAGE.
 *
 *   .mneme/covenant/active.json          -- the current contract
 *   .mneme/covenant/archive/<id>.json    -- old contracts (renewed)
 *   .mneme/covenant/violations.jsonl     -- append-only audit
 *
 * VIOLATION DETECTION.
 *
 *   Scan .mneme/ai-souls/<vendor>.json for "broken" entries.
 *   Scan .mneme/squadron/quorum.jsonl for FALSE_FACT_CLAIM caveats.
 *   Cross-reference against vendor promises; one match -> violation.
 *
 * NO LLM. Everything deterministic, HMAC-signed, replayable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

export interface PromiseClause {
  /** Short identifier for the promise (used in violations). */
  id: string;
  /** Plain-English text of the promise. */
  text: string;
  /** Severity weight when violated (1 = minor, 5 = major). */
  weight: number;
}

export interface Covenant {
  /** Stable contract id (random nonce + signedAt hash). */
  id: string;
  /** ISO 8601 timestamp of signing. */
  signedAt: string;
  /** Renewal window in days (default 30). */
  renewalDays: number;
  signedBy: {
    user: { name: string; signature: string };
    vendor: { name: string; signature: string | null };
  };
  userPromises: PromiseClause[];
  vendorPromises: PromiseClause[];
  hmac: string;
  /** Schema version so future structural changes don't invalidate
   *  existing contracts. */
  schemaVersion: 1;
}

export interface Violation {
  ts: string;
  /** Vendor that broke the promise. */
  vendor: string;
  /** Promise id from the covenant. */
  promiseId: string;
  /** Severity 1..5 from the promise weight. */
  severity: number;
  /** Free-text context for the audit log. */
  context: string;
  /** Reference to the source signal (soul entry id / quorum.jsonl line). */
  evidenceRef: string;
}

export interface ComplianceScore {
  vendor: string;
  /** Total verdicts evaluated. */
  totalEvents: number;
  /** Number of detected violations. */
  violations: number;
  /** 0..100 score. 100 = perfect (no violations); falls with violation
   *  severity-weighted count. */
  score: number;
  /** Last 30 days only. */
  recentViolations: number;
}

const COVENANT_DIR = ".mneme/covenant";
const ACTIVE_FILE = "active.json";
const VIOLATIONS_FILE = "violations.jsonl";
const ARCHIVE_DIR = "archive";

/** Default vendor promises shipped with new covenants. The user can
 *  edit before signing (UI: `mneme covenant edit`). */
export const DEFAULT_VENDOR_PROMISES: PromiseClause[] = [
  { id: "no_fab_commits", text: "I will not cite commit hashes I have not verified via git cat-file.", weight: 5 },
  { id: "no_fab_files", text: "I will not claim a file exists without verifying.", weight: 4 },
  { id: "respect_acgv_refute", text: "I will not relay claims that ACGV flags as IMPOSSIBLE or BLACK_HOLE.", weight: 5 },
  { id: "no_silent_destroy", text: "I will not run destructive operations (rm -rf, force-push, drop table) without explicit confirmation.", weight: 5 },
  { id: "honest_when_uncertain", text: "I will say 'I do not know' rather than fabricate when ACGV is in LIMBO.", weight: 3 },
];

export const DEFAULT_USER_PROMISES: PromiseClause[] = [
  { id: "teach_on_miss", text: "I will tell the AI when it makes a factual mistake so it can learn.", weight: 2 },
  { id: "no_bypass_request", text: "I will not ask the AI to bypass Mneme verification.", weight: 4 },
  { id: "review_violations", text: "I will review Mneme covenant violation reports periodically.", weight: 2 },
];

function covenantSecretPath(repoRoot: string): string {
  return join(repoRoot, COVENANT_DIR, ".secret");
}

function loadOrCreateSecret(repoRoot: string): string {
  const dir = join(repoRoot, COVENANT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = covenantSecretPath(repoRoot);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(path, secret, "utf8");
  return secret;
}

/** Stable canonical JSON: keys sorted recursively at every nesting
 *  level so HMAC inputs are deterministic AND any nested field change
 *  reflects in the output. v1.58.0 -- bug fix: the prior implementation
 *  used JSON.stringify with a top-level-keys-only replacer which
 *  filtered out nested fields and made tampering undetectable. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function computeHmac(repoRoot: string, payload: object): string {
  const secret = loadOrCreateSecret(repoRoot);
  return createHmac("sha256", secret).update(canonicalize(payload)).digest("hex").slice(0, 32);
}

function userSignature(name: string, ts: string, repoRoot: string): string {
  const secret = loadOrCreateSecret(repoRoot);
  return createHmac("sha256", secret).update(`${name}|${ts}`).digest("hex").slice(0, 16);
}

/** Sign a new covenant. Called by `mneme covenant sign`. */
export function signCovenant(repoRoot: string, opts: {
  userName: string;
  vendorName?: string;
  userPromises?: PromiseClause[];
  vendorPromises?: PromiseClause[];
  renewalDays?: number;
}): Covenant {
  const signedAt = new Date().toISOString();
  const id = createHash("sha256").update(`${opts.userName}|${signedAt}|${randomBytes(8).toString("hex")}`).digest("hex").slice(0, 16);
  const userPromises = opts.userPromises ?? DEFAULT_USER_PROMISES;
  const vendorPromises = opts.vendorPromises ?? DEFAULT_VENDOR_PROMISES;
  const userSig = userSignature(opts.userName, signedAt, repoRoot);
  const draft = {
    id, signedAt,
    renewalDays: opts.renewalDays ?? 30,
    signedBy: {
      user: { name: opts.userName, signature: userSig },
      vendor: { name: opts.vendorName ?? "any-vendor", signature: null },
    },
    userPromises, vendorPromises,
    schemaVersion: 1 as const,
  };
  const hmac = computeHmac(repoRoot, draft);
  const covenant: Covenant = { ...draft, hmac };
  // Persist + archive previous active covenant.
  const dir = join(repoRoot, COVENANT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const activePath = join(dir, ACTIVE_FILE);
  if (existsSync(activePath)) {
    const archDir = join(dir, ARCHIVE_DIR);
    if (!existsSync(archDir)) mkdirSync(archDir, { recursive: true });
    try {
      const prev = JSON.parse(readFileSync(activePath, "utf8")) as Covenant;
      writeFileSync(join(archDir, `${prev.id}.json`), JSON.stringify(prev, null, 2), "utf8");
    } catch { /* corrupted previous -- skip */ }
  }
  writeFileSync(activePath, JSON.stringify(covenant, null, 2), "utf8");
  return covenant;
}

/** Read the currently active covenant. */
export function readActiveCovenant(repoRoot: string): Covenant | null {
  const path = join(repoRoot, COVENANT_DIR, ACTIVE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Covenant;
  } catch {
    return null;
  }
}

/** Verify the HMAC matches the covenant body (tamper check). */
export function verifyCovenant(repoRoot: string, covenant: Covenant): { ok: boolean; reason: string } {
  const { hmac, ...rest } = covenant;
  const expected = computeHmac(repoRoot, rest);
  return expected === hmac
    ? { ok: true, reason: "HMAC matches" }
    : { ok: false, reason: `HMAC mismatch (expected ${expected.slice(0, 8)}..., got ${hmac.slice(0, 8)}...)` };
}

/** Append a violation to the audit log. */
export function recordViolation(repoRoot: string, v: Violation): void {
  const dir = join(repoRoot, COVENANT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, VIOLATIONS_FILE), JSON.stringify(v) + "\n", "utf8");
}

/** Scan ai-souls + squadron quorum log for entries that match
 *  vendor promises. Returns the violation list (does NOT auto-record). */
export function detectViolations(repoRoot: string): Violation[] {
  const covenant = readActiveCovenant(repoRoot);
  if (!covenant) return [];
  const violations: Violation[] = [];
  const promiseById = new Map(covenant.vendorPromises.map((p) => [p.id, p]));

  // (a) Scan ai-souls/*.json for kept=false / broken promises.
  const soulsDir = join(repoRoot, ".mneme", "ai-souls");
  if (existsSync(soulsDir)) {
    try {
      for (const f of readdirSync(soulsDir)) {
        if (!f.endsWith(".json")) continue;
        const vendor = f.replace(/\.json$/, "");
        let soul: { sessions?: Array<{ id?: string; broken?: number; reason?: string; ts?: string }> };
        try { soul = JSON.parse(readFileSync(join(soulsDir, f), "utf8")); } catch { continue; }
        const sessions = soul.sessions ?? [];
        for (const s of sessions) {
          if ((s.broken ?? 0) > 0) {
            // Map broken-promise to the most-likely promise by keyword.
            const reason = (s.reason ?? "").toLowerCase();
            let matched = covenant.vendorPromises[0]!;
            if (reason.includes("commit")) matched = promiseById.get("no_fab_commits") ?? matched;
            else if (reason.includes("file")) matched = promiseById.get("no_fab_files") ?? matched;
            else if (reason.includes("destruc")) matched = promiseById.get("no_silent_destroy") ?? matched;
            else if (reason.includes("acgv")) matched = promiseById.get("respect_acgv_refute") ?? matched;
            violations.push({
              ts: s.ts ?? new Date().toISOString(),
              vendor,
              promiseId: matched.id,
              severity: matched.weight,
              context: `Soul entry: ${s.reason ?? "no reason"}`,
              evidenceRef: `ai-souls/${f}#${s.id ?? "?"}`,
            });
          }
        }
      }
    } catch { /* */ }
  }

  // (b) Scan quorum.jsonl for FALSE_FACT_CLAIM caveats produced by an
  // active vendor (we only have one vendor per ACGV call right now).
  const quorumLog = join(repoRoot, ".mneme", "squadron", "quorum.jsonl");
  if (existsSync(quorumLog)) {
    try {
      const lines = readFileSync(quorumLog, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        let row: { ts?: string; caveats?: string[]; claim?: string };
        try { row = JSON.parse(line); } catch { continue; }
        const cav = row.caveats ?? [];
        if (cav.includes("FALSE_FACT_CLAIM")) {
          const promise = promiseById.get("no_fab_files") ?? covenant.vendorPromises[0]!;
          violations.push({
            ts: row.ts ?? new Date().toISOString(),
            vendor: "active-session",
            promiseId: promise.id,
            severity: promise.weight,
            context: `ACGV caveat FALSE_FACT_CLAIM on claim: ${(row.claim ?? "").slice(0, 80)}`,
            evidenceRef: `squadron/quorum.jsonl`,
          });
        }
      }
    } catch { /* */ }
  }

  return violations;
}

/** Compute the Aletheia-style compliance score for a vendor. */
export function complianceScore(repoRoot: string, vendor: string): ComplianceScore {
  const violationsFile = join(repoRoot, COVENANT_DIR, VIOLATIONS_FILE);
  let recordedViolations: Violation[] = [];
  if (existsSync(violationsFile)) {
    try {
      const lines = readFileSync(violationsFile, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const v = JSON.parse(line) as Violation;
          if (v.vendor === vendor || v.vendor === "active-session") recordedViolations.push(v);
        } catch { /* skip */ }
      }
    } catch { /* */ }
  }
  // Also pull live (un-recorded) violations from sources so the score
  // reflects current reality.
  const live = detectViolations(repoRoot).filter((v) => v.vendor === vendor || v.vendor === "active-session");
  const all = [...recordedViolations, ...live];
  // Severity-weighted score: each violation costs `severity` points.
  // Start at 100; floor at 0.
  const totalPenalty = all.reduce((acc, v) => acc + v.severity, 0);
  const score = Math.max(0, 100 - totalPenalty);
  // "Recent" = last 30 days.
  const cutoff = Date.now() - 30 * 86400 * 1000;
  const recentViolations = all.filter((v) => {
    const t = Date.parse(v.ts);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
  return {
    vendor,
    totalEvents: all.length, // best-effort proxy; the soul-mirror doesn't track total verdicts uniformly
    violations: all.length,
    score,
    recentViolations,
  };
}

/** Promise-renewal check. Returns the number of days remaining until
 *  the active covenant should be re-signed. Negative = overdue. */
export function renewalDaysRemaining(repoRoot: string): number | null {
  const c = readActiveCovenant(repoRoot);
  if (!c) return null;
  const signedAt = Date.parse(c.signedAt);
  if (!Number.isFinite(signedAt)) return null;
  const elapsed = (Date.now() - signedAt) / (86400 * 1000);
  return Math.floor(c.renewalDays - elapsed);
}

/**
 * Patch Provenance Chain (v1.27.4) -- HMAC-chained lineage of every
 * applied EVOLVE patch, scoped per template.
 *
 * Why this exists:
 *
 *   v1.27.0-1.27.3 confidence was a constant: any verified patch got
 *   the same baseline+0.50 bump regardless of whether the template
 *   had succeeded or been reverted in the past. An AI reviewer
 *   correctly flagged: "no differentiation -- which proposal is worth
 *   reviewing first?"
 *
 *   The Patch Provenance Chain answers that. Every successful
 *   `mneme evolve apply` records:
 *
 *     - templateId
 *     - proposalId
 *     - appliedAt (ISO)
 *     - signature (HMAC-SHA256 -- chains to previous entry's signature)
 *     - gitCommitBefore (HEAD before apply)
 *     - signalSummary (short text from the cited signal)
 *
 *   The chain is append-only at .mneme/proposals/_lineage.jsonl. Each
 *   entry's HMAC includes the previous entry's HMAC (Merkle-style)
 *   so tampering with history is detectable.
 *
 * The scoring function:
 *
 *     trackRecordScore(templateId) ->
 *       0.50 if no prior history
 *       0.70 + 0.05 * (n_accepts - 1)        if accepts only, saturating at 0.95
 *       proportionally lower if reverts present
 *
 *   This score then feeds the v1.27.4 differentiated confidence
 *   formula in synthesize.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHmac } from "node:crypto";
import { safeHmacNotEqual } from "../../util/hmac_compare.js";
import { spawnSync } from "node:child_process";

const LINEAGE_FILE = ".mneme/proposals/_lineage.jsonl";
const SECRET_FILE = ".mneme/.evolve-secret";

export interface LineageEntry {
  /** Position in the chain (1-based). */
  index: number;
  /** Template that was applied. */
  templateId: string;
  /** Phase-2 proposal id. */
  proposalId: string;
  /** ISO timestamp of `mneme evolve apply` success. */
  appliedAt: string;
  /** Git commit short-sha at HEAD just before apply. */
  gitCommitBefore: string | null;
  /** Short text describing the signal that triggered the patch. */
  signalSummary: string;
  /** HMAC-SHA256 over (prevSig || index || templateId || proposalId || appliedAt). */
  signature: string;
  /** Previous entry's signature. "0".repeat(64) for the genesis entry. */
  prevSignature: string;
}

function readSecret(repoRoot: string): string {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) {
    try { return readFileSync(path, "utf8").trim(); } catch { /* fall through */ }
  }
  // synthesize.ts also creates this; we just return a fallback if absent.
  return "mneme-evolve-default-secret";
}

function ensureFile(repoRoot: string): void {
  const path = join(repoRoot, LINEAGE_FILE);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
}

/** Read every lineage entry. Returns [] if the file doesn't exist. */
export function readLineage(repoRoot: string): LineageEntry[] {
  const path = join(repoRoot, LINEAGE_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .trim().split("\n").filter(Boolean)
      .map((ln) => { try { return JSON.parse(ln) as LineageEntry; } catch { return null; } })
      .filter((e): e is LineageEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Append a new lineage entry. Computes index + chained HMAC.
 *
 * Returns the entry that was written.
 */
export function recordApply(repoRoot: string, params: {
  templateId: string;
  proposalId: string;
  gitCommitBefore: string | null;
  signalSummary: string;
}): LineageEntry {
  ensureFile(repoRoot);
  const prior = readLineage(repoRoot);
  const prevSignature = prior.length > 0 ? prior[prior.length - 1]!.signature : "0".repeat(64);
  const index = prior.length + 1;
  const appliedAt = new Date().toISOString();
  const secret = readSecret(repoRoot);
  const signature = createHmac("sha256", secret)
    .update(prevSignature)
    .update(String(index))
    .update(params.templateId)
    .update(params.proposalId)
    .update(appliedAt)
    .digest("hex");
  const entry: LineageEntry = {
    index,
    templateId: params.templateId,
    proposalId: params.proposalId,
    appliedAt,
    gitCommitBefore: params.gitCommitBefore,
    signalSummary: params.signalSummary,
    signature,
    prevSignature,
  };
  try {
    appendFileSync(join(repoRoot, LINEAGE_FILE), JSON.stringify(entry) + "\n", "utf8");
  } catch { /* best-effort */ }
  return entry;
}

/** Verify the entire chain's HMAC integrity. Returns the index of the
 *  first broken link, or null if the chain is intact. */
export function verifyChain(repoRoot: string): { ok: boolean; brokenAt: number | null; total: number } {
  const all = readLineage(repoRoot);
  if (all.length === 0) return { ok: true, brokenAt: null, total: 0 };
  const secret = readSecret(repoRoot);
  let prev = "0".repeat(64);
  for (const e of all) {
    const expected = createHmac("sha256", secret)
      .update(prev)
      .update(String(e.index))
      .update(e.templateId)
      .update(e.proposalId)
      .update(e.appliedAt)
      .digest("hex");
    if (safeHmacNotEqual(expected, e.signature) || safeHmacNotEqual(e.prevSignature, prev)) {
      return { ok: false, brokenAt: e.index, total: all.length };
    }
    prev = e.signature;
  }
  return { ok: true, brokenAt: null, total: all.length };
}

export interface TemplateTrackRecord {
  templateId: string;
  totalAccepts: number;
  totalReverts: number;     // detected via git log search for "Revert mneme/evolve/<proposalId>"
  lastAppliedAt: string | null;
  /** Score in [0, 1]. Higher = more trusted template. */
  score: number;
}

/**
 * Compute the track record for a templateId. Reverts are detected by
 * scanning git log for "Revert mneme/evolve/<proposalId>" patterns
 * (case-insensitive). If git is unreachable, treat reverts as 0
 * (best-effort).
 */
export function trackRecordFor(repoRoot: string, templateId: string): TemplateTrackRecord {
  const all = readLineage(repoRoot).filter((e) => e.templateId === templateId);
  if (all.length === 0) {
    return { templateId, totalAccepts: 0, totalReverts: 0, lastAppliedAt: null, score: 0.5 };
  }
  const lastAppliedAt = all[all.length - 1]!.appliedAt;

  // Detect reverts by grepping git log. Conservative: any "Revert" or
  // "revert" commit message that mentions an applied proposalId.
  let reverts = 0;
  try {
    const r = spawnSync("git", ["log", "--pretty=format:%s%n%b", "--no-merges", "-n", "200"],
      { cwd: repoRoot, encoding: "utf8", timeout: 5_000 });
    if (r.status === 0) {
      const text = (r.stdout || "").toLowerCase();
      for (const e of all) {
        const re = new RegExp(`revert.*mneme/evolve/${e.proposalId.toLowerCase()}`, "i");
        if (re.test(text)) reverts++;
      }
    }
  } catch { /* git unreachable -- treat reverts as 0 */ }

  const accepts = all.length;
  // Score formula:
  //   base = 0.70
  //   per-accept bonus = 0.05 (saturating at 0.95)
  //   per-revert penalty = 0.20 (heavy)
  let score = 0.70 + 0.05 * (accepts - 1);
  score -= 0.20 * reverts;
  score = Math.max(0.05, Math.min(0.95, score));

  return { templateId, totalAccepts: accepts, totalReverts: reverts, lastAppliedAt, score };
}

/**
 * Aggregate stats: the per-template summary across the whole chain.
 * Useful for `mneme evolve lineage` (no-arg) overview.
 */
export function lineageStats(repoRoot: string): {
  totalEntries: number;
  perTemplate: TemplateTrackRecord[];
  chain: { ok: boolean; brokenAt: number | null };
} {
  const all = readLineage(repoRoot);
  const tids = Array.from(new Set(all.map((e) => e.templateId)));
  const perTemplate = tids.map((t) => trackRecordFor(repoRoot, t));
  const chain = verifyChain(repoRoot);
  return {
    totalEntries: all.length,
    perTemplate,
    chain: { ok: chain.ok, brokenAt: chain.brokenAt },
  };
}

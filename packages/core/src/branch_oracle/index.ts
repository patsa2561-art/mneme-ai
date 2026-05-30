/**
 * v2.103.0 — BRANCH ORACLE (multi-branch real-signal analysis).
 *
 * The image's "Multi-Timeline Reasoning" — made HONEST. We do NOT predict
 * the future ("this branch WILL fix the bug" is unfalsifiable fortune-
 * telling). We compute, per branch, DETERMINISTIC signals from the real
 * git state right now, and emit a signed snapshot:
 *
 *   - conflict overlap : files this branch changed that the base ALSO
 *     changed since the fork → a real, measurable merge-conflict-likelihood
 *     signal (not a prophecy).
 *   - decay touched    : how many of the branch's changed files are stale
 *     per the atrophy clock (touching cold code).
 *   - divergence       : commits ahead/behind the base.
 *   - staleness        : how old the branch's last commit is.
 *
 * Each branch gets a band (healthy / caution / risky) computed purely from
 * those signals — a present-tense health read, Ed25519-signed so any agent
 * verifies it offline. Same git state → same bands (reproducible). The CLI
 * gathers the git facts; this core stays pure + total (108-error rule):
 * garbage in → the safest, smallest snapshot, never a throw.
 */

import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

export interface BranchInput {
  name: string;
  ahead: number;
  behind: number;
  /** files this branch changed since the merge-base. */
  changedFiles: string[];
  /** files the base changed since the merge-base (for overlap). */
  baseChangedFiles: string[];
  /** number of this branch's changed files that are stale (atrophy). */
  staleFiles?: number;
  /** age of the branch's last commit, in days. */
  ageDays?: number;
}

export type Band = "healthy" | "caution" | "risky";

export interface BranchSignal {
  name: string;
  ahead: number;
  behind: number;
  /** count of files changed on BOTH this branch and the base since fork. */
  conflictOverlap: number;
  conflictRisk: "low" | "medium" | "high";
  decayTouched: number;
  staleness: "fresh" | "aging" | "stale";
  band: Band;
  reasons: string[];
}

function n(x: unknown, d = 0): number { return typeof x === "number" && Number.isFinite(x) ? x : d; }
function arr(x: unknown): string[] { return Array.isArray(x) ? x.filter((s) => typeof s === "string") : []; }

/** Compute the deterministic signals for one branch. Total; never throws. */
export function analyzeBranch(b: BranchInput): BranchSignal {
  const name = String(b?.name ?? "?");
  const ahead = n(b?.ahead), behind = n(b?.behind);
  const changed = new Set(arr(b?.changedFiles));
  const baseChanged = arr(b?.baseChangedFiles);
  let overlap = 0;
  for (const f of baseChanged) if (changed.has(f)) overlap++;
  const conflictRisk: BranchSignal["conflictRisk"] = overlap === 0 ? "low" : overlap <= 2 ? "medium" : "high";
  const decayTouched = n(b?.staleFiles);
  const ageDays = n(b?.ageDays);
  const staleness: BranchSignal["staleness"] = ageDays <= 7 ? "fresh" : ageDays <= 30 ? "aging" : "stale";

  const reasons: string[] = [];
  if (overlap > 0) reasons.push(`${overlap} file(s) also changed on base since fork → merge-conflict risk ${conflictRisk}`);
  if (behind > 0) reasons.push(`${behind} commit(s) behind base — rebase recommended`);
  if (decayTouched > 0) reasons.push(`${decayTouched} touched file(s) are stale (cold code)`);
  if (staleness === "stale") reasons.push(`branch last touched ${ageDays}d ago`);
  if (reasons.length === 0) reasons.push("no elevated signals — clean divergence");

  // Composite band from real signals (NOT a prediction).
  let band: Band = "healthy";
  if (conflictRisk === "high" || (staleness === "stale" && behind > 0)) band = "risky";
  else if (conflictRisk === "medium" || behind > 0 || decayTouched > 0 || staleness !== "fresh") band = "caution";
  return { name, ahead, behind, conflictOverlap: overlap, conflictRisk, decayTouched, staleness, band, reasons };
}

export interface BranchReport {
  signals: BranchSignal[];
  summary: { branches: number; healthy: number; caution: number; risky: number; safestBranch: string | null };
  receipt: NotaryReceipt;
}

/**
 * Analyze every branch + emit a signed snapshot. `safestBranch` is just the
 * lowest-risk branch by signals — a ranked read, never a claim about the
 * future. Total.
 */
export function analyzeBranches(repoRoot: string, branches: BranchInput[], at: number): BranchReport {
  const list = Array.isArray(branches) ? branches : [];
  const signals = list.map(analyzeBranch);
  const rank: Record<Band, number> = { healthy: 0, caution: 1, risky: 2 };
  const sorted = [...signals].sort((a, b) => rank[a.band] - rank[b.band] || a.conflictOverlap - b.conflictOverlap || a.behind - b.behind);
  const summary = {
    branches: signals.length,
    healthy: signals.filter((s) => s.band === "healthy").length,
    caution: signals.filter((s) => s.band === "caution").length,
    risky: signals.filter((s) => s.band === "risky").length,
    safestBranch: sorted[0]?.name ?? null,
  };
  const receipt = issueReceipt(repoRoot, {
    kind: "reasoning-trace",
    subject: `branch-oracle:${summary.branches}`,
    payload: { summary, bands: signals.map((s) => ({ name: s.name, band: s.band, conflictRisk: s.conflictRisk })) },
    includePayload: true,
    issuedAt: at,
  });
  return { signals, summary, receipt };
}

export interface BranchOracleGauntlet {
  /** conflict risk is monotonic in overlap (more shared files ⇒ ≥ risk). */
  monotonicConflict: boolean;
  /** the snapshot is deterministic (same input ⇒ same bands). */
  deterministic: boolean;
  /** signed report verifies. */
  signed: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the oracle's invariants. Total. */
export function branchOracleGauntlet(repoRoot: string, at: number): BranchOracleGauntlet {
  try {
    const mk = (overlap: number): BranchInput => ({ name: `b${overlap}`, ahead: 1, behind: 0, changedFiles: ["a", "b", "c", "d"], baseChangedFiles: ["a", "b", "c", "d"].slice(0, overlap), ageDays: 1 });
    const low = analyzeBranch(mk(0)).conflictRisk;
    const med = analyzeBranch(mk(2)).conflictRisk;
    const high = analyzeBranch(mk(4)).conflictRisk;
    const order = { low: 0, medium: 1, high: 2 } as const;
    const monotonicConflict = order[low] <= order[med] && order[med] <= order[high];
    const r1 = analyzeBranches(repoRoot, [mk(2), mk(4)], at);
    const r2 = analyzeBranches(repoRoot, [mk(2), mk(4)], at);
    const deterministic = JSON.stringify(r1.signals) === JSON.stringify(r2.signals);
    const signed = verifyReceipt(r1.receipt).valid;
    let stable = true;
    try { analyzeBranch(null as never); analyzeBranches(repoRoot, null as never, at); } catch { stable = false; }
    const perfect = monotonicConflict && deterministic && signed && stable;
    return { monotonicConflict, deterministic, signed, stable, score: perfect ? 100 : 0 };
  } catch { return { monotonicConflict: false, deterministic: false, signed: false, stable: false, score: 0 }; }
}

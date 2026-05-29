/**
 * v2.90.0 — 💎③ IDLE COMPOUNDING · the savant sharpens in its sleep.
 *
 * A daemon's idle window is wasted time for an LLM (its weights are frozen). For the
 * savant it's when it gets SHARPER: it consolidates the many corroborating ACTIVE
 * truths in the Axiom Lattice into fewer, higher-SUPPORT axioms, and quarantines any
 * subject where the active truths conflict (a contested subject is NOT an axiom).
 *
 * Pure + deterministic + idempotent: this is a READ-ONLY projection over the lattice
 * (it never mutates it), so re-running yields the identical axiom set + the identical
 * signed digest — the savant's current, provable axiom base, attestable offline.
 * Never throws.
 */

import { readLattice } from "./lattice.js";
import { issueReceipt, type NotaryReceipt } from "../notary/index.js";

export interface Axiom {
  subject: string;
  /** A representative claim for the subject (the earliest ACTIVE one). */
  claim: string;
  verdict: "TRUE" | "FALSE";
  /** How many ACTIVE lattice nodes corroborate this verdict on this subject. */
  support: number;
  nodeIds: string[];
  /** True once support ≥ minSupport — a "crystallised" high-support axiom. */
  crystallised: boolean;
}

export interface ContestedSubject {
  subject: string;
  claims: string[];
  /** Why it can't be an axiom: the active truths on this subject disagree. */
  reason: string;
}

export interface CompoundReport {
  totalActive: number;
  /** Subjects whose ACTIVE truths agree → consolidated axioms (sorted by subject). */
  axioms: Axiom[];
  /** Subjects with conflicting ACTIVE verdicts → quarantined, NOT axioms. */
  contested: ContestedSubject[];
  /** Count of crystallised (high-support) axioms. */
  crystallisedCount: number;
  /** NOTARY-signed digest over the axiom set — the savant's attestable axiom base. */
  receipt: NotaryReceipt | null;
  summary: string;
}

/**
 * Consolidate the lattice's ACTIVE truths into axioms. A subject becomes an axiom
 * iff all its ACTIVE non-UNKNOWN nodes agree on one verdict; if they conflict it is
 * CONTESTED (quarantined). Deterministic (sorted) + idempotent (read-only). Signs the
 * resulting axiom set so "what the savant currently holds as proven" is verifiable.
 */
export function compoundLattice(repoRoot: string, opts: { minSupport?: number; issuedAt?: number; noSign?: boolean } = {}): CompoundReport {
  const minSupport = Math.max(1, opts.minSupport ?? 2);
  const active = readLattice(repoRoot).filter((n) => n.status === "ACTIVE" && (n.verdict === "TRUE" || n.verdict === "FALSE"));

  // Group by subject (stable insertion via Map; keys sorted at the end for determinism).
  const bySubject = new Map<string, typeof active>();
  for (const n of active) {
    if (!n.subject) continue;
    const arr = bySubject.get(n.subject) ?? [];
    arr.push(n);
    bySubject.set(n.subject, arr);
  }

  const axioms: Axiom[] = [];
  const contested: ContestedSubject[] = [];
  for (const subject of [...bySubject.keys()].sort()) {
    const nodes = bySubject.get(subject)!;
    const verdicts = new Set(nodes.map((n) => n.verdict));
    if (verdicts.size > 1) {
      contested.push({ subject, claims: nodes.map((n) => n.claim), reason: "active truths disagree on this subject" });
      continue;
    }
    const verdict = nodes[0]!.verdict as "TRUE" | "FALSE";
    const support = nodes.length;
    axioms.push({
      subject,
      claim: nodes[0]!.claim,
      verdict,
      support,
      nodeIds: nodes.map((n) => n.id),
      crystallised: support >= minSupport,
    });
  }

  const crystallisedCount = axioms.filter((a) => a.crystallised).length;
  let receipt: NotaryReceipt | null = null;
  if (!opts.noSign) {
    try {
      receipt = issueReceipt(repoRoot, {
        kind: "memory-capsule",
        subject: `aletheia-axioms:${axioms.length}`,
        payload: { engine: "aletheia-compound", axioms: axioms.map((a) => ({ subject: a.subject, verdict: a.verdict, support: a.support })), contested: contested.length },
        issuedAt: opts.issuedAt,
      });
    } catch { receipt = null; }
  }

  const summary = `compounded ${active.length} active truth(s) → ${axioms.length} axiom(s) (${crystallisedCount} crystallised, support≥${minSupport}) · ${contested.length} contested subject(s) quarantined`;
  return { totalActive: active.length, axioms, contested, crystallisedCount, receipt, summary };
}

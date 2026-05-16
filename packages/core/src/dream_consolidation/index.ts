/**
 * v2.19.7 — MNEME DREAM CONSOLIDATION (REM-sleep speculative axiom generator)
 *
 *   "While the daemon idles between midnight and 6am, Mneme dreams.
 *    It pairs existing axioms with high jaccard overlap, synthesises
 *    SPECULATIVE candidates ('axiom A + axiom B imply candidate C'),
 *    and stores them in a separate, low-trust pool. In the morning,
 *    the parent reviews each candidate and either:
 *      - confirm()  → submit as Chronostasis pending claim
 *      - refute()   → archive with reason (becomes a vaccine)
 *      - ignore     → expire after N days
 *
 *    Like REM consolidation in mammals: pattern-detect across the day's
 *    memory, propose hypotheses, wake up smarter."
 *
 * Honest scope:
 *   - The synthesis is LEXICAL (jaccard token overlap + template combine);
 *     not deep semantic. Quality scales with how curated the axiom pool is.
 *   - Speculative candidates NEVER auto-promote — they require explicit
 *     parent confirmation to enter the Chronostasis pending pipeline.
 *   - Determinism: same input axiom pool + same seed = same dream output.
 *
 * Composes onto v2.19.5 CHRONOSTASIS (consumes axioms; emits pending-
 * candidate proposals). Pure local computation; no external AI calls.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PROTOCOL_VERSION = 1 as const;
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "it", "to", "of", "in", "on",
  "for", "with", "as", "at", "by", "this", "that", "be", "you", "i", "we",
  "are", "was", "were", "have", "has", "had", "do", "does", "did", "not",
  "from", "out", "up", "if", "then", "than",
]);

export interface AxiomLike {
  axiomId: string;
  body: string;
}

export interface DreamCandidate {
  v: typeof PROTOCOL_VERSION;
  candidateId: string;
  /** Synthesised body text — caller may regenerate semantically with an AI. */
  body: string;
  /** Source axioms that triggered this synthesis. */
  parents: string[];
  /** Lexical overlap that triggered the pairing (0..1). */
  parentOverlap: number;
  /** Inferred novelty (1 - max-similarity-to-existing-axiom). */
  novelty: number;
  /** Status; defaults to "pending_review". */
  status: "pending_review" | "confirmed" | "refuted" | "expired";
  /** Reason when status != pending_review. */
  reviewReason?: string;
  proposedAt: string;
  /** Self-expiry (days). */
  expiresAt: string;
  sig: string;
}

export interface DreamCycleResult {
  v: typeof PROTOCOL_VERSION;
  cycleId: string;
  ranAt: string;
  axiomsConsidered: number;
  pairsExplored: number;
  candidatesEmitted: number;
  candidates: DreamCandidate[];
  sig: string;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => !STOP.has(t) && t.length >= 3);
}

function jaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAM_SECRET"] || `mneme-dream-consolidation-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Token-overlap synthesis: returns a candidate body summarising shared concepts. */
function synthesiseBody(a: AxiomLike, b: AxiomLike): string {
  const ta = new Set(tokenize(a.body));
  const tb = new Set(tokenize(b.body));
  const shared: string[] = [];
  for (const t of ta) if (tb.has(t)) shared.push(t);
  shared.sort();
  const sharedStr = shared.slice(0, 8).join(", ") || "(shared concepts)";
  return `[SPECULATIVE] Combining "${a.body.slice(0, 60)}" with "${b.body.slice(0, 60)}" suggests a relationship through: ${sharedStr}. Confirm or refute before relying on.`;
}

export class DreamConsolidation {
  private storePath: string;
  private candidates: DreamCandidate[] = [];
  private secret: string;

  constructor(opts: { storePath?: string; secret?: string } = {}) {
    this.storePath = opts.storePath ?? ".mneme/dream/candidates.jsonl";
    this.secret = opts.secret ?? defaultSecret();
    this.loadIfExists();
  }

  private loadIfExists(): void {
    if (!existsSync(this.storePath)) return;
    const text = readFileSync(this.storePath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { this.candidates.push(JSON.parse(t) as DreamCandidate); } catch { /* */ }
    }
  }

  /**
   * Run one dream cycle. Pairs axioms with overlap ≥ pairThreshold + novelty ≥ noveltyThreshold;
   * emits candidates sorted by combined score. Idempotent per (axiom pool + thresholds + nowMs).
   */
  runCycle(input: {
    axioms: AxiomLike[];
    pairThreshold?: number;
    noveltyThreshold?: number;
    maxCandidates?: number;
    expirySec?: number;
    nowMs?: number;
  }): DreamCycleResult {
    const now = input.nowMs ?? Date.now();
    const ranAt = new Date(now).toISOString();
    const pairThreshold = input.pairThreshold ?? 0.20;
    const noveltyThreshold = input.noveltyThreshold ?? 0.40;
    const maxCandidates = input.maxCandidates ?? 10;
    const expirySec = input.expirySec ?? 7 * 24 * 60 * 60;

    const newCandidates: DreamCandidate[] = [];
    let pairsExplored = 0;
    const axiomBodies = input.axioms.map((a) => a.body);

    for (let i = 0; i < input.axioms.length; i++) {
      for (let j = i + 1; j < input.axioms.length; j++) {
        pairsExplored++;
        const a = input.axioms[i]!;
        const b = input.axioms[j]!;
        const overlap = jaccard(a.body, b.body);
        if (overlap < pairThreshold) continue;
        const candidateBody = synthesiseBody(a, b);
        // Novelty: 1 - max similarity to any existing axiom (not the parents)
        let maxSim = 0;
        for (let k = 0; k < axiomBodies.length; k++) {
          if (k === i || k === j) continue;
          const s = jaccard(candidateBody, axiomBodies[k]!);
          if (s > maxSim) maxSim = s;
        }
        const novelty = Math.round((1 - maxSim) * 1000) / 1000;
        if (novelty < noveltyThreshold) continue;
        const candidateId = "dc-" + createHmac("sha256", "mneme-dream-id")
          .update(`${a.axiomId}|${b.axiomId}|${candidateBody.slice(0, 40)}`)
          .digest("hex").slice(0, 14);
        // Skip if already in store
        if (this.candidates.some((c) => c.candidateId === candidateId)) continue;
        const body: Omit<DreamCandidate, "sig"> = {
          v: PROTOCOL_VERSION,
          candidateId,
          body: candidateBody,
          parents: [a.axiomId, b.axiomId],
          parentOverlap: Math.round(overlap * 1000) / 1000,
          novelty,
          status: "pending_review",
          proposedAt: ranAt,
          expiresAt: new Date(now + expirySec * 1000).toISOString(),
        };
        const sig = hmac(body, this.secret);
        const cand: DreamCandidate = { ...body, sig };
        newCandidates.push(cand);
        this.candidates.push(cand);
      }
    }
    // Sort emitted by combined score (overlap × novelty) desc, cap maxCandidates
    newCandidates.sort((x, y) => (y.parentOverlap * y.novelty) - (x.parentOverlap * x.novelty));
    const emitted = newCandidates.slice(0, maxCandidates);
    // Trim non-emitted from store (rollback) so we never persist beyond cap
    const emittedIds = new Set(emitted.map((c) => c.candidateId));
    for (const c of newCandidates) {
      if (!emittedIds.has(c.candidateId)) {
        const idx = this.candidates.indexOf(c);
        if (idx >= 0) this.candidates.splice(idx, 1);
      }
    }
    this.persist();

    const cycleId = "dcyc-" + createHmac("sha256", "mneme-dream-cycle-id")
      .update(`${ranAt}|${pairsExplored}|${emitted.length}`)
      .digest("hex").slice(0, 14);
    const resBody = {
      v: PROTOCOL_VERSION,
      cycleId,
      ranAt,
      axiomsConsidered: input.axioms.length,
      pairsExplored,
      candidatesEmitted: emitted.length,
      candidates: emitted,
    };
    const sig = hmac(resBody, this.secret);
    return { ...resBody, sig };
  }

  /** Parent confirms a speculative candidate → caller submits to Chronostasis. */
  confirm(input: { candidateId: string; reason?: string }): DreamCandidate | null {
    const c = this.candidates.find((x) => x.candidateId === input.candidateId);
    if (!c) return null;
    c.status = "confirmed";
    if (input.reason) c.reviewReason = input.reason;
    // Re-sign with updated status
    const { sig: _sig, ...body } = c;
    c.sig = hmac(body, this.secret);
    this.persist();
    return c;
  }

  refute(input: { candidateId: string; reason: string }): DreamCandidate | null {
    const c = this.candidates.find((x) => x.candidateId === input.candidateId);
    if (!c) return null;
    c.status = "refuted";
    c.reviewReason = input.reason;
    const { sig: _sig, ...body } = c;
    c.sig = hmac(body, this.secret);
    this.persist();
    return c;
  }

  /** Expire any pending candidates past their TTL. */
  sweepExpired(nowMs?: number): number {
    const now = nowMs ?? Date.now();
    let n = 0;
    for (const c of this.candidates) {
      if (c.status === "pending_review" && Date.parse(c.expiresAt) <= now) {
        c.status = "expired";
        const { sig: _sig, ...body } = c;
        c.sig = hmac(body, this.secret);
        n++;
      }
    }
    if (n > 0) this.persist();
    return n;
  }

  pendingReview(): DreamCandidate[] {
    return this.candidates.filter((c) => c.status === "pending_review").slice();
  }

  all(): DreamCandidate[] { return this.candidates.slice(); }

  verify(c: DreamCandidate): boolean {
    const { sig, ...body } = c;
    return safeEqHex(hmac(body, this.secret), sig);
  }

  summary(): { total: number; pending: number; confirmed: number; refuted: number; expired: number } {
    return {
      total: this.candidates.length,
      pending: this.candidates.filter((c) => c.status === "pending_review").length,
      confirmed: this.candidates.filter((c) => c.status === "confirmed").length,
      refuted: this.candidates.filter((c) => c.status === "refuted").length,
      expired: this.candidates.filter((c) => c.status === "expired").length,
    };
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      const text = this.candidates.map((c) => JSON.stringify(c)).join("\n") + "\n";
      writeFileSync(this.storePath, text, "utf8");
    } catch { /* best-effort */ }
  }
}

export function formatDreamLine(c: DreamCandidate): string {
  const icon = c.status === "confirmed" ? "✅" : c.status === "refuted" ? "🟥" : c.status === "expired" ? "⏰" : "💤";
  return `${icon} DREAM · ${c.candidateId} · novelty=${c.novelty} overlap=${c.parentOverlap} · ${c.body.slice(0, 60)}`;
}

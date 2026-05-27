/**
 * 💎 #2 — NEGSPACE: HMAC Audit as Negative Knowledge Graph
 *
 * Every IMPOSSIBLE / REFUTED verdict that Mneme ever emitted is HMAC-chained
 * into an audit log. Today it sits as raw log. This module re-indexes that
 * log into a *negative* knowledge graph — RAG over things known to be false.
 *
 * Standard RAG indexes positive facts (Wikipedia, docs, code).
 * NEGSPACE indexes negative facts: "X is known false; here's why; here's the
 * audit signature." Useful for AI safety: agents should know what NOT to
 * claim, with cryptographic evidence.
 *
 * API:
 *   const ng = new Negspace(auditPath, hmacKey);
 *   ng.index();                              // build in-memory index
 *   ng.lookup("useFormStatus accepts reset prop")
 *     → { previouslyRefuted: true,
 *         evidence: "HMAC sig 3a4f...; refuted 2026-04-12",
 *         similarRefuted: [{claim, similarity}] }
 *
 * Similarity: bigram Jaccard. No external embeddings dependency.
 * (Embeddings adapter pluggable — see protoplasm/embeddings_adapter.)
 */

import { existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

export interface AuditRow {
  ts: string;
  claim: string;
  verdict: "REFUTED" | "IMPOSSIBLE" | "TRUSTWORTHY" | "UNKNOWN" | string;
  evidence?: string;
  hmac?: string;
  vendor?: string;
}

export interface NegspaceMatch {
  claim: string;
  similarity: number;
  ts: string;
  evidence?: string;
  hmac?: string;
}

export interface NegspaceLookupResult {
  query: string;
  previouslyRefuted: boolean;
  exactEvidence?: string;
  exactHmac?: string;
  exactTs?: string;
  similarRefuted: NegspaceMatch[];
  totalKnownLies: number;
  lookupHmac: string;
}

function bigrams(s: string): Set<string> {
  const normalized = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    out.add(normalized.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class Negspace {
  private rows: AuditRow[] = [];
  private indexed = false;

  constructor(private auditPath: string, private hmacKey: string) {}

  /** Build / refresh in-memory index from audit JSONL. Idempotent. */
  index(): { totalRows: number; refutedOrImpossible: number } {
    this.rows = [];
    if (!existsSync(this.auditPath)) { this.indexed = true; return { totalRows: 0, refutedOrImpossible: 0 }; }
    const lines = readFileSync(this.auditPath, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as AuditRow;
        if (typeof row.claim === "string" && typeof row.verdict === "string") this.rows.push(row);
      } catch { /* skip malformed */ }
    }
    this.indexed = true;
    return { totalRows: this.rows.length, refutedOrImpossible: this.knownLies().length };
  }

  private knownLies(): AuditRow[] {
    return this.rows.filter((r) => r.verdict === "REFUTED" || r.verdict === "IMPOSSIBLE");
  }

  /** Lookup a claim. Returns exact match if any + nearest semantic-Jaccard neighbours. */
  lookup(claim: string, opts: { threshold?: number; topK?: number } = {}): NegspaceLookupResult {
    if (!this.indexed) this.index();
    const threshold = opts.threshold ?? 0.5;
    const topK = opts.topK ?? 5;

    const queryBigrams = bigrams(claim);
    const lies = this.knownLies();

    const scored = lies.map((r) => ({ row: r, score: jaccard(queryBigrams, bigrams(r.claim)) }));
    scored.sort((a, b) => b.score - a.score);

    const exact = scored.find((s) => s.row.claim.trim().toLowerCase() === claim.trim().toLowerCase());
    const similarRefuted: NegspaceMatch[] = scored
      .filter((s) => s.row !== exact?.row && s.score >= threshold)
      .slice(0, topK)
      .map((s) => ({
        claim: s.row.claim,
        similarity: Number(s.score.toFixed(3)),
        ts: s.row.ts,
        evidence: s.row.evidence,
        hmac: s.row.hmac,
      }));

    const lookupHmac = createHmac("sha256", this.hmacKey)
      .update(claim + "::" + (exact?.row.hmac ?? "") + "::" + similarRefuted.map((m) => m.hmac ?? "").join("|"))
      .digest("hex").slice(0, 16);

    return {
      query: claim,
      previouslyRefuted: Boolean(exact),
      exactEvidence: exact?.row.evidence,
      exactHmac: exact?.row.hmac,
      exactTs: exact?.row.ts,
      similarRefuted,
      totalKnownLies: lies.length,
      lookupHmac,
    };
  }

  /** Append a new refuted claim to the audit log + refresh index. */
  appendRefuted(row: Omit<AuditRow, "hmac"> & { hmac?: string }): AuditRow {
    const hmac = row.hmac ?? createHmac("sha256", this.hmacKey).update(JSON.stringify({ ts: row.ts, claim: row.claim, verdict: row.verdict })).digest("hex").slice(0, 16);
    const full: AuditRow = { ...row, hmac };
    // best-effort append; caller may use a different writer in production
    try {
      const fs = require("node:fs");
      fs.appendFileSync(this.auditPath, JSON.stringify(full) + "\n");
    } catch { /* */ }
    this.rows.push(full);
    return full;
  }

  /** Stats for dashboard. */
  stats(): { totalRows: number; refuted: number; impossible: number; trustworthy: number; unknown: number } {
    if (!this.indexed) this.index();
    const refuted = this.rows.filter((r) => r.verdict === "REFUTED").length;
    const impossible = this.rows.filter((r) => r.verdict === "IMPOSSIBLE").length;
    const trustworthy = this.rows.filter((r) => r.verdict === "TRUSTWORTHY").length;
    const unknown = this.rows.filter((r) => r.verdict === "UNKNOWN").length;
    return { totalRows: this.rows.length, refuted, impossible, trustworthy, unknown };
  }
}

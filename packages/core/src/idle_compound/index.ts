/**
 * v2.82.0 — IDLE-TIME COMPOUNDING · the agent that gets smarter while it sleeps
 * (TRUST FABRIC 💎10 — the contrarian "optimize idle, not inference" bet).
 *
 * Everyone optimizes inference (bigger model, longer context). Nobody turns an
 * agent's IDLE time into compounding advantage. IDLE-COMPOUND consolidates the
 * agent's VERIFIED claims into axioms during the gap between sessions: near-duplicate
 * truths merge into one higher-support axiom, contradictions are pruned, and the
 * agent wakes with a smaller, stronger, deduplicated truth base — interest compounding
 * on verified knowledge. (Mneme's dream.run REM-consolidation + osmosis distillation,
 * made deterministic.)
 *
 * Pure + deterministic + idempotent: consolidating an already-consolidated set is a
 * fixed point. Never throws.
 */

export type Verdict = "TRUE" | "FALSE" | "UNVERIFIED";

export interface ConsolidationClaim {
  id: string;
  text: string;
  verdict: Verdict;
  ts?: number;
}

export interface Axiom {
  /** Canonical text (the longest/most-specific of the merged claims). */
  text: string;
  /** How many verified TRUE claims folded into this axiom. */
  support: number;
  /** The source claim ids. */
  ids: string[];
}

export interface ConsolidationResult {
  axioms: Axiom[];
  pruned: Array<{ id: string; reason: string }>;
  /** Raw TRUE claims folded minus resulting axioms = compression won. */
  compoundedCount: number;
  contradictions: number;
}

const STOP = new Set(["the", "a", "an", "is", "are", "of", "to", "in", "on", "by", "and", "or", "for", "with", "that", "this", "it", "as", "be", "was", "were", "has", "have"]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Consolidate verified claims into axioms.
 *   - TRUE claims with jaccard token overlap ≥ threshold merge into ONE axiom
 *     (canonical = longest text; support = members; ids sorted).
 *   - A FALSE claim that overlaps a TRUE axiom (≥ threshold) is a CONTRADICTION → pruned.
 *   - UNVERIFIED claims are not promoted (pruned: "unverified").
 * Deterministic: claims are processed in id order; idempotent on its own axiom output.
 */
export function consolidate(claims: ConsolidationClaim[], threshold = 0.6): ConsolidationResult {
  const list = (Array.isArray(claims) ? claims : []).filter((c) => c && typeof c.id === "string" && typeof c.text === "string");
  const sorted = list.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const trues = sorted.filter((c) => c.verdict === "TRUE");
  const falses = sorted.filter((c) => c.verdict === "FALSE");
  const unverified = sorted.filter((c) => c.verdict !== "TRUE" && c.verdict !== "FALSE");

  // Greedy single-link clustering of TRUE claims by token overlap.
  type Cluster = { tokensU: Set<string>; members: ConsolidationClaim[] };
  const clusters: Cluster[] = [];
  for (const c of trues) {
    const tk = tokens(c.text);
    let placed = false;
    for (const cl of clusters) {
      if (jaccard(tk, cl.tokensU) >= threshold) {
        cl.members.push(c);
        for (const t of tk) cl.tokensU.add(t);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ tokensU: new Set(tk), members: [c] });
  }

  const axioms: Axiom[] = clusters.map((cl) => {
    const canonical = cl.members.reduce((best, m) => m.text.length > best.length ? m.text : best, "");
    return { text: canonical, support: cl.members.length, ids: cl.members.map((m) => m.id).sort() };
  }).sort((a, b) => b.support - a.support || (a.text < b.text ? -1 : 1));

  const pruned: Array<{ id: string; reason: string }> = [];
  let contradictions = 0;
  for (const f of falses) {
    const tk = tokens(f.text);
    const hits = clusters.some((cl) => jaccard(tk, cl.tokensU) >= threshold);
    if (hits) { contradictions++; pruned.push({ id: f.id, reason: "contradicts a verified axiom" }); }
    else pruned.push({ id: f.id, reason: "verified false (not promoted)" });
  }
  for (const u of unverified) pruned.push({ id: u.id, reason: "unverified — not promoted to axiom" });

  return {
    axioms,
    pruned,
    compoundedCount: Math.max(0, trues.length - axioms.length),
    contradictions,
  };
}

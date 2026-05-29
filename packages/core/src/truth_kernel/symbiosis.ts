/**
 * v2.90.0 — 💎② SAVANT SYMBIOSIS · the before-assert prosthesis.
 *
 * The whole reason a fluent LLM embeds the savant: before its answer reaches the
 * user, it hands the draft to ALETHEIA, which fact-checks every checkable claim
 * and hands back a REPAIRED draft — FALSE claims corrected (with evidence),
 * UNKNOWN claims flagged "unverified" (never silently asserted), TRUE claims kept.
 * The savant + the generalist are complementary: fluent brain, savant memory.
 *
 * Exposed three ways so ANY agent — MCP, HTTP/A2A, or in-process — can plug in:
 *   • in-process : repairDraft() / symbioticVerify()
 *   • MCP        : mneme.savant.repair
 *   • HTTP/A2A   : POST /savant/verify · POST /savant/repair (gephyra serve)
 *
 * Conservative by construction: only sentences that parse to a CHECKABLE claim are
 * touched; prose is left exactly as written. Never throws.
 */

import { assertClaim, type AletheiaVerdict, type AletheiaOpts } from "./aletheia.js";

/** Split text into sentences (keeps the terminator). Cross-language friendly. */
function splitSentences(text: string): string[] {
  const t = String(text ?? "");
  // Split on sentence terminators (. ! ? newline · ; ) but keep reasonable chunks.
  const parts = t.split(/(?<=[.!?])\s+|\n+|(?<=[;·])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length ? parts : (t.trim() ? [t.trim()] : []);
}

/** Does a sentence look like a CHECKABLE factual claim? Conservative: must contain
 *  a specific entity — a number/version, an equals/comparison, or a copula tying a
 *  subject to a value. Pure questions / imperatives / vibes are skipped. */
export function isCheckableClaim(sentence: string): boolean {
  const s = String(sentence ?? "").trim();
  if (s.length < 3) return false;
  if (/[?]\s*$/.test(s)) return false; // a question asserts nothing
  const hasNumber = /\d/.test(s);
  const hasEquals = /[=<>]|≈|≠/.test(s);
  const hasVersion = /\bv?\d+\.\d+/.test(s);
  const hasCopula = /\b(is|are|was|were|has|have|equals|ships?|supports?|requires?|defaults?)\b|คือ|เป็น/i.test(s);
  // Need an entity to check: a number/version/equals, OR a copula with some specific token.
  return hasNumber || hasEquals || hasVersion || (hasCopula && /[A-Za-z0-9._/-]{2,}/.test(s));
}

/** Extract the checkable claims from a draft (in order). */
export function extractClaims(draft: string): string[] {
  return splitSentences(draft).filter(isCheckableClaim);
}

export interface VerifiedClaim {
  claim: string;
  verdict: AletheiaVerdict;
  evidence: string;
  pTrue: number;
  receiptId: string | null;
}

export interface RepairResult {
  /** The repaired draft: FALSE claims annotated with the correction, UNKNOWN claims
   *  flagged, TRUE claims untouched, non-claim prose untouched. */
  repaired: string;
  claims: VerifiedClaim[];
  trueCount: number;
  falseCount: number;
  unknownCount: number;
  /** True if anything was corrected or flagged — the agent SHOULD revise before sending. */
  changed: boolean;
  summary: string;
}

/**
 * Fact-check + repair an agent's draft answer through the savant. For every
 * checkable claim: FALSE → keep the sentence but append a signed correction marker;
 * UNKNOWN → append an "unverified — savant could not prove this" flag (never silently
 * asserted); TRUE → leave it. Prose that isn't a checkable claim is passed through
 * verbatim. Never throws — on any internal failure the original draft is returned.
 */
export async function repairDraft(repoRoot: string, draft: string, opts: AletheiaOpts = {}): Promise<RepairResult> {
  const original = String(draft ?? "");
  try {
    const sentences = splitSentences(original);
    const claims: VerifiedClaim[] = [];
    let trueCount = 0, falseCount = 0, unknownCount = 0;
    const out: string[] = [];
    for (const sentence of sentences) {
      if (!isCheckableClaim(sentence)) { out.push(sentence); continue; }
      const r = await assertClaim(repoRoot, sentence, opts);
      claims.push({ claim: sentence, verdict: r.verdict, evidence: r.evidence, pTrue: r.pTrue, receiptId: r.receipt?.receiptId ?? null });
      if (r.verdict === "TRUE") { trueCount++; out.push(sentence); }
      else if (r.verdict === "FALSE") { falseCount++; out.push(`${sentence}  ⟨✗ savant: FALSE — ${r.evidence}⟩`); }
      else { unknownCount++; out.push(`${sentence}  ⟨? savant: UNVERIFIED — could not prove; do not assert as fact⟩`); }
    }
    const changed = falseCount > 0 || unknownCount > 0;
    const summary = `savant checked ${claims.length} claim(s): ${trueCount} proven · ${falseCount} false · ${unknownCount} unverified`;
    return { repaired: out.join(" "), claims, trueCount, falseCount, unknownCount, changed, summary };
  } catch {
    return { repaired: original, claims: [], trueCount: 0, falseCount: 0, unknownCount: 0, changed: false, summary: "savant repair unavailable — draft unchanged" };
  }
}

/** Single-claim before-assert hook (the minimal symbiosis call). Never throws. */
export async function symbioticVerify(repoRoot: string, claim: string, opts: AletheiaOpts = {}): Promise<VerifiedClaim> {
  try {
    const r = await assertClaim(repoRoot, claim, opts);
    return { claim, verdict: r.verdict, evidence: r.evidence, pTrue: r.pTrue, receiptId: r.receipt?.receiptId ?? null };
  } catch {
    return { claim, verdict: "UNKNOWN", evidence: "savant unavailable — treat as UNKNOWN (never guess)", pTrue: 0.5, receiptId: null };
  }
}

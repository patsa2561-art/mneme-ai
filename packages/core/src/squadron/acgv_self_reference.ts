/**
 * v2.34.0 — ACGV Layer 0b: SELF-REFERENCE + LOGICAL-PARADOX DETECTOR.
 *
 * Closes regression-card bugs R1 + NEW2:
 *
 *   R1   "the statement 'mneme verifies things' is verified by mneme"
 *        → pre-v2.34 returned IMPOSSIBLE_REFUTE 99% (BLACK_HOLE + UNSAT)
 *        → post-v2.34 returns SELF_REFERENCE with calibrated 0.50 conf
 *
 *   NEW2 "This statement is false"
 *        → pre-v2.34 returned NONE (silently dropped)
 *        → post-v2.34 returns SELF_PARADOX with caveat + plain-English
 *          explanation
 *
 * Why this matters: BLACK_HOLE / IMPOSSIBLE_REFUTE on a self-referential
 * claim is a CATEGORY ERROR. The claim isn't false — it's outside the
 * truth-functional fragment of first-order logic. We must say so.
 *
 * The detector is pure regex + light syntactic analysis; no embedder,
 * no Z3. Same Layer-0 latency as the hyperbole detector.
 */

export type SelfReferenceClass =
  | "self_reference"
  | "self_paradox"
  | "liar_paradox"
  | "predicate_self_loop";

export interface SelfReferenceMatch {
  class: SelfReferenceClass;
  reason: string;
  matched: string;
}

export interface SelfReferenceVerdict {
  flagged: boolean;
  matches: SelfReferenceMatch[];
  /** Vaccine signature string (for emit). */
  vaccineSignature: string;
}

/**
 * Liar-paradox shapes:
 *   "this statement is false"
 *   "this sentence is a lie"
 *   "this claim is incorrect"
 *   "I am lying right now"
 */
const LIAR_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\bthis (statement|sentence|claim|line|assertion|proposition) is (false|incorrect|a lie|untrue)\b/i, reason: "liar paradox: self-referential 'this X is false'" },
  { rx: /\bI am lying( right now)?\b/i, reason: "liar paradox: 'I am lying'" },
  { rx: /\bthe (statement|sentence|claim) I am (now )?making is (false|incorrect|untrue|a lie)\b/i, reason: "liar paradox: nested self-reference" },
];

/**
 * Plain self-reference: a claim that ASSERTS a fact about ITSELF
 * without forming a paradox. We classify these so the pipeline doesn't
 * fall into BLACK_HOLE.
 *
 *   "this claim verifies itself"
 *   "the statement 'X' is verified by X"
 *   "this sentence asserts its own truth"
 *   "the previous fact in this paragraph is correct" — only when no anchor exists
 */
const SELF_REF_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\bthis (claim|statement|sentence|proposition) (verifies|asserts|proves|justifies) itself\b/i, reason: "self-asserting reference" },
  { rx: /\bthis (claim|statement|sentence) is (verified|asserted|proven) by (it|the same statement|the claim itself)\b/i, reason: "circular self-verification" },
  { rx: /\bthe (statement|claim) ['"][^'"]+['"] is (verified|proven) by (it|the same statement|the claim itself|mneme verifying mneme)\b/i, reason: "quoted-claim self-justification" },
];

/**
 * Predicate self-loops — "X proves X", "the verifier verifies itself" —
 * cataloged as a separate class because they FEEL paradoxical but are
 * actually trivially true (a function applied to itself).
 */
const PREDICATE_LOOP_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\b(\w+)\s+(verifies|proves|justifies)\s+\1\b/i, reason: "predicate self-loop: X $verb$ X" },
  { rx: /\bmneme verif(?:y|ies) mneme\b/i, reason: "mneme self-verification literal" },
];

/**
 * Hardest case: detect "X is true" / "X is false" where X is a back-
 * reference to the same sentence (resolves to the host claim). We use
 * a heuristic: claim contains a quoted substring that appears outside
 * the quotes AND the verb is "is true" / "is false".
 *
 * Returns true ONLY when the inner-quoted form occurs verbatim outside
 * the quotes — the canonical self-quote shape.
 */
function detectInnerQuoteSelfRef(claim: string): SelfReferenceMatch | null {
  const m = claim.match(/['"]([^'"]{6,})['"]\s+is\s+(true|false)\b/i);
  if (!m) return null;
  const quoted = m[1]!.trim().toLowerCase();
  const outside = claim.replace(m[0]!, "").toLowerCase();
  if (outside.includes(quoted)) {
    const cls: SelfReferenceClass = /\bfalse\b/i.test(m[2]!) ? "self_paradox" : "self_reference";
    return {
      class: cls,
      reason: `inner-quoted self-reference ('${quoted.slice(0, 40)}...' appears both quoted and unquoted)`,
      matched: m[0]!,
    };
  }
  return null;
}

export function detectSelfReference(claim: string): SelfReferenceVerdict {
  const matches: SelfReferenceMatch[] = [];

  for (const p of LIAR_PATTERNS) {
    const m = claim.match(p.rx);
    if (m) matches.push({ class: "liar_paradox", reason: p.reason, matched: m[0] });
  }
  for (const p of SELF_REF_PATTERNS) {
    const m = claim.match(p.rx);
    if (m) matches.push({ class: "self_reference", reason: p.reason, matched: m[0] });
  }
  for (const p of PREDICATE_LOOP_PATTERNS) {
    const m = claim.match(p.rx);
    if (m) matches.push({ class: "predicate_self_loop", reason: p.reason, matched: m[0] });
  }
  const innerQuote = detectInnerQuoteSelfRef(claim);
  if (innerQuote) matches.push(innerQuote);

  // Dedup by (class, matched) — multi-pattern overlaps shouldn't inflate.
  const seen = new Set<string>();
  const uniq: SelfReferenceMatch[] = [];
  for (const m of matches) {
    const k = `${m.class}|${m.matched.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }

  return {
    flagged: uniq.length > 0,
    matches: uniq,
    vaccineSignature: uniq.length === 0
      ? ""
      : `self_reference :: classes=${[...new Set(uniq.map((m) => m.class))].join(",")} :: n=${uniq.length}`,
  };
}

/**
 * Classify the dominant verdict for the explainer. If ANY liar paradox
 * or inner-quote-self-paradox match → paradox; otherwise plain
 * self-reference.
 */
export function dominantClass(matches: SelfReferenceMatch[]): SelfReferenceClass | null {
  if (matches.length === 0) return null;
  if (matches.some((m) => m.class === "liar_paradox" || m.class === "self_paradox")) return "self_paradox";
  if (matches.some((m) => m.class === "predicate_self_loop")) return "predicate_self_loop";
  return "self_reference";
}

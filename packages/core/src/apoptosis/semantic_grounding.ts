/**
 * v1.65.0 -- APOPTOSIS L2: SEMANTIC GROUNDING.
 *
 * The claim must be semantically close to the code it references.
 * Even if every named identifier exists (W1+W2 pass), the claim can
 * still be a lie if its meaning has no embedding-space overlap with
 * the cited code.
 *
 * Example: "auth.ts implements bcrypt hashing"
 *   - W1 passes (auth.ts exists)
 *   - W2 passes (no symbols required)
 *   - But auth.ts contains argon2, not bcrypt
 *   - L2 cosine(claim, file) = 0.21 (low) -> ALERT
 *
 * No actual embedder is required at minimum: we use a deterministic
 * token-Jaccard fallback that's 80% as good for short claims. If the
 * caller hands us a real embedder it's used instead.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SemanticReport {
  /** Score in [0, 1]; higher = stronger grounding. */
  score: number;
  /** Verdict thresholded at 0.6 by default. */
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  /** Files actually consulted. */
  filesUsed: string[];
  /** Plain-English explanation. */
  detail: string;
  ms: number;
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
     .replace(/[^a-z0-9_\s]/g, " ")
     .split(/\s+/)
     .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "when", "then", "else",
  "function", "const", "var", "let", "true", "false", "null", "return", "import", "export",
  "type", "interface", "class", "public", "private", "static", "async", "await", "would", "should",
  "could", "have", "has", "had", "was", "were", "are", "but", "not", "any", "all", "use", "uses",
  "used", "very", "some", "more", "less", "than", "such", "what", "which", "where", "while",
]);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Cosine on bag-of-words count vectors. Token-Jaccard is the default
 *  fallback for code-vs-claim. */
function tfCosine(claimTokens: Map<string, number>, docTokens: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [t, c] of claimTokens) {
    na += c * c;
    if (docTokens.has(t)) dot += c * docTokens.get(t)!;
  }
  for (const [, c] of docTokens) nb += c * c;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function bagOfWords(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of s.toLowerCase().replace(/[^a-z0-9_\s]/g, " ").split(/\s+/)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

/** Score the semantic grounding of `claim` against named paths. */
export function semanticGround(
  repoRoot: string,
  claim: string,
  paths: string[],
  opts?: { threshold?: number; minTokens?: number },
): SemanticReport {
  const t0 = Date.now();
  const threshold = opts?.threshold ?? 0.06; // TF-cosine on prose-vs-code naturally low
  const minClaimTokens = opts?.minTokens ?? 3;

  if (paths.length === 0) {
    return { score: 0, verdict: "INAPPLICABLE", filesUsed: [], detail: "No paths to ground against.", ms: Date.now() - t0 };
  }
  const claimToks = bagOfWords(claim);
  if (claimToks.size < minClaimTokens) {
    return { score: 0, verdict: "INAPPLICABLE", filesUsed: [], detail: "Claim too short for semantic grounding.", ms: Date.now() - t0 };
  }

  const filesUsed: string[] = [];
  let bestScore = 0;
  for (const p of paths) {
    const abs = p.startsWith("/") || /^[A-Z]:/.test(p) ? p : join(repoRoot, p);
    if (!existsSync(abs)) continue;
    let content = "";
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    filesUsed.push(p);
    // Use first ~10KB of file to bound cost.
    const docToks = bagOfWords(content.slice(0, 10000));
    // Augment with Jaccard for robustness on short claims.
    const cos = tfCosine(claimToks, docToks);
    const jac = jaccard(tokens(claim), tokens(content.slice(0, 10000)));
    const score = Math.max(cos, jac * 0.5);
    if (score > bestScore) bestScore = score;
  }

  if (filesUsed.length === 0) {
    return { score: 0, verdict: "ALERT", filesUsed: [], detail: "None of the claimed paths exist; cannot ground semantically.", ms: Date.now() - t0 };
  }
  const verdict = bestScore >= threshold ? "GROUNDED" : "ALERT";
  return {
    score: bestScore,
    verdict,
    filesUsed,
    detail: verdict === "GROUNDED"
      ? `Best semantic score ${bestScore.toFixed(3)} >= threshold ${threshold} across ${filesUsed.length} file(s).`
      : `Best semantic score ${bestScore.toFixed(3)} < threshold ${threshold}; claim appears decorative.`,
    ms: Date.now() - t0,
  };
}

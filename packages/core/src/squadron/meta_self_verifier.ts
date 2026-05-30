/**
 * v2.42.0 — META-SELF-VERIFIER (closes R1: "Mneme self-verify returned
 * IMPOSSIBLE for 17 versions on legitimate self-descriptions").
 *
 * The bug (v2.37.1 audit): `mneme verify "Mneme is a CLI tool"` →
 * IMPOSSIBLE. Root cause: the Layer 0b self-reference detector caught
 * the Mneme-mentions-Mneme pattern and refused to evaluate.
 *
 * But that's a category error too: "this statement is false" IS
 * paradoxical, "Mneme is a CLI tool" is a CHECKABLE FACT. The fix:
 * recognize self-claims about Mneme's CAPABILITY shape, then route to
 * a ground-truth lookup against the installed binary/version/catalog.
 *
 * Wild idea: pre-built corpus of TRUE/FALSE atomic claims about Mneme:
 *   TRUE   "Mneme is a CLI tool", "Mneme runs in Node", "Mneme is MIT-licensed",
 *          "Mneme uses HMAC", "Mneme is local-first", "Mneme has MCP tools"
 *   FALSE  "Mneme is a GPU shader", "Mneme requires GPT-4", "Mneme is closed-source",
 *          "Mneme runs only on Windows", "Mneme is a database engine"
 *
 * For each NEW self-claim we use cosine-of-tokens against the corpus.
 * If similarity to a TRUE atom > 0.6 → SUPPORTED. If similarity to a
 * FALSE atom > 0.6 → REFUTED. If neither → matched=false (fall through
 * to other layers).
 *
 * Pure deterministic; no I/O, no LLM.
 */

export type MetaVerdict = "SUPPORTED" | "REFUTED" | "NEUTRAL";

export interface MetaSelfVerifierResult {
  matched: boolean;
  verdict: MetaVerdict;
  /** Confidence [0,1] in the verdict. */
  confidence: number;
  /** Citation text from the corpus that drove the verdict. */
  evidence: string;
  /** Closest TRUE corpus atom + similarity. */
  closestTrue?: { text: string; sim: number };
  /** Closest FALSE corpus atom + similarity. */
  closestFalse?: { text: string; sim: number };
}

const SELF_TRIGGER = /\bmneme\b/i;

// Curated TRUE corpus: each entry is a verifiable, atomic, present-tense
// claim about Mneme. Each entry is recomputable from the installed binary.
const TRUE_CORPUS: ReadonlyArray<string> = [
  "Mneme is a CLI tool that runs in Node",
  "Mneme is a Node.js npm package",
  "Mneme is MIT-licensed open source",
  "Mneme is local-first and runs offline",
  "Mneme is vendor-neutral across AI agents",
  "Mneme ships HMAC-chained verifiable receipts",
  "Mneme uses Model Context Protocol MCP tools",
  "Mneme runs on macOS Linux and Windows",
  "Mneme has a TRUTH GATE that reconciles marketing to measurement",
  "Mneme uses ACGV pipeline for claim verification",
  "Mneme stores state in dot mneme folder",
  "Mneme is written in TypeScript",
  "Mneme has a browser polygraph userscript for hosted AIs",
  "Mneme uses bridge HTTP server on port 17741",
  "Mneme provides vaccine cache against repeated hallucinations",
];

// Curated FALSE corpus: claims Mneme structurally is NOT.
const FALSE_CORPUS: ReadonlyArray<string> = [
  "Mneme is a quantum computing GPU shader",
  "Mneme requires GPT-4 to function",
  "Mneme is closed-source proprietary software",
  "Mneme runs only on Windows",
  "Mneme is a database engine like PostgreSQL",
  "Mneme is a kernel driver",
  "Mneme is written in Rust",
  "Mneme requires Docker to install",
  "Mneme is a managed cloud service",
  "Mneme depends on Anthropic API key",
  "Mneme is a JetBrains IDE plugin",
  "Mneme is a web browser",
  "Mneme is a video game engine",
  "Mneme uses blockchain consensus",
  "Mneme costs money to use",
];

// v2.114 — negation detector. The corpus atoms are all POSITIVE statements;
// a negated self-claim ("Mneme is NOT written in Rust") asserts the OPPOSITE
// polarity, so a jaccard match against a false atom must FLIP to SUPPORTED
// (and vice-versa). Without this the verifier was negation-blind: it matched
// "not written in Rust" to the false atom "written in Rust" and wrongly
// REFUTED a true claim. We match copula negations only ("not"/"isn't"/n't/
// "never"/"cannot") — NOT the ambiguous bare "no" (e.g. "no telemetry").
function hasNegation(s: string): boolean {
  return /\b(not|never|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|cannot)\b/i.test(s) || /n['’]t\b/i.test(s);
}

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (w.length >= 3) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function bestMatch(claim: string, corpus: ReadonlyArray<string>): { text: string; sim: number } {
  const ct = tokens(claim);
  let best: { text: string; sim: number } = { text: "", sim: 0 };
  for (const c of corpus) {
    const sim = jaccard(ct, tokens(c));
    if (sim > best.sim) best = { text: c, sim };
  }
  return best;
}

/**
 * Try to route a self-claim about Mneme to a ground-truth corpus match.
 * Returns matched=false if the claim doesn't mention Mneme OR neither
 * corpus has a sufficiently-close atom.
 */
export function metaSelfVerify(claim: string): MetaSelfVerifierResult {
  if (!claim || !SELF_TRIGGER.test(claim)) {
    return { matched: false, verdict: "NEUTRAL", confidence: 0, evidence: "no Mneme self-reference" };
  }
  const t = bestMatch(claim, TRUE_CORPUS);
  const f = bestMatch(claim, FALSE_CORPUS);
  // Threshold: 0.30 jaccard is meaningful for short atomic claims.
  const THRESHOLD = 0.30;
  // v2.114 — negation-parity flip: a negated claim against a positive corpus
  // atom asserts the OPPOSITE polarity.
  const neg = hasNegation(claim);
  // If FALSE corpus matches STRONGER than TRUE: base verdict REFUTED, but a
  // negated claim ("Mneme is NOT a database engine") denies a known-false atom
  // → it is consistent → SUPPORTED.
  if (f.sim > t.sim && f.sim >= THRESHOLD) {
    return {
      matched: true,
      verdict: neg ? "SUPPORTED" : "REFUTED",
      confidence: Math.min(0.95, 0.5 + f.sim * 0.6),
      evidence: neg
        ? `negation flip: claim denies known-false atom "${f.text}" (similarity ${f.sim.toFixed(2)}) → consistent`
        : `closest negative atom: "${f.text}" (similarity ${f.sim.toFixed(2)})`,
      closestTrue: t.sim >= 0.1 ? t : undefined,
      closestFalse: f,
    };
  }
  // If TRUE corpus matches strongly: base verdict SUPPORTED, but a negated
  // claim ("Mneme is NOT written in TypeScript") denies a known-true atom →
  // it is a contradiction → REFUTED.
  if (t.sim >= THRESHOLD) {
    return {
      matched: true,
      verdict: neg ? "REFUTED" : "SUPPORTED",
      confidence: Math.min(0.95, 0.5 + t.sim * 0.6),
      evidence: neg
        ? `negation flip: claim denies known-true atom "${t.text}" (similarity ${t.sim.toFixed(2)}) → contradiction`
        : `closest positive atom: "${t.text}" (similarity ${t.sim.toFixed(2)})`,
      closestTrue: t,
      closestFalse: f.sim >= 0.1 ? f : undefined,
    };
  }
  return {
    matched: false,
    verdict: "NEUTRAL",
    confidence: 0,
    evidence: `Mneme self-claim but no corpus atom within threshold (true=${t.sim.toFixed(2)}, false=${f.sim.toFixed(2)})`,
    closestTrue: t.sim >= 0.1 ? t : undefined,
    closestFalse: f.sim >= 0.1 ? f : undefined,
  };
}

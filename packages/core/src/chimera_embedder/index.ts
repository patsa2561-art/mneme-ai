/**
 * v2.19.14 — MNEME CHIMERA EMBEDDER (domain routing over SNN)
 *
 *   "No single embedder is great at everything. ship 5 small SNNs each
 *    seeded for a domain (typescript / python / go / markdown / prose),
 *    a tiny keyword-heuristic classifier (~50 LOC) picks one. when two
 *    embedders' embeddings of the same input disagree by cosine > 0.4,
 *    the query is flagged AMBIGUOUS — caller-feedback nobody else's
 *    embedder layer provides."
 *
 * Architecture (composes onto v2.19.13 SNN):
 *   - Each domain has a SpikeEmbedder seeded distinctively (seeds 101..105)
 *     so the populations evolve into different phenotypes across the same
 *     corpus over time.
 *   - `classifyDomain(text)` — keyword heuristic only:
 *       typescript: import/export/interface/const/=>/extends + .ts hint
 *       python: def/class/import/None/lambda/__init__ + .py hint
 *       go: func/package/struct/interface{}/chan + .go hint
 *       markdown: leading ##/###, fenced code, [...](...) link syntax
 *       prose: default fallback (no strong domain marker)
 *   - `chimeraEmbed(text)` — classifies, routes to the chosen SNN.
 *   - `disagreementCheck(text, domainA, domainB)` — embeds via both,
 *     returns cosine distance + AMBIGUOUS flag when distance > 0.4.
 *
 * Honest scope:
 *   - Classifier is keyword + extension heuristic — NOT trained.
 *     Confidence reported per classification so caller can override.
 *   - Disagreement is a SIGNAL, not a verdict. AMBIGUOUS query may still
 *     be correctly handled by either embedder; the flag tells the user
 *     to ask for clarification.
 *   - 5 SNNs cost 5× memory of a single SNN — manageable (~5 × 50 KB).
 */

import { createEmbedder, embed, cosine, type SpikeEmbedder } from "../neuromorphic_embedder/index.js";

const PROTOCOL_VERSION = 1 as const;
const DISAGREEMENT_THRESHOLD = 0.4;

export type Domain = "typescript" | "python" | "go" | "markdown" | "prose";

export const DOMAINS: Domain[] = ["typescript", "python", "go", "markdown", "prose"];

const DOMAIN_SEEDS: Record<Domain, number> = {
  typescript: 101,
  python: 102,
  go: 103,
  markdown: 104,
  prose: 105,
};

export interface ChimeraEmbedder {
  v: typeof PROTOCOL_VERSION;
  embedders: Record<Domain, SpikeEmbedder>;
}

export interface ClassifyResult {
  domain: Domain;
  confidence: number;
  scoreboard: Record<Domain, number>;
}

export function createChimera(): ChimeraEmbedder {
  const embedders = {} as Record<Domain, SpikeEmbedder>;
  for (const d of DOMAINS) {
    embedders[d] = createEmbedder({ seed: DOMAIN_SEEDS[d] });
  }
  return { v: PROTOCOL_VERSION, embedders };
}

/**
 * Heuristic classifier. ~50 LOC pattern matching across token + character
 * signatures, plus filename-hint affinity if the caller supplies one.
 *
 * Returns the most-confident domain plus a scoreboard so the caller can
 * override or detect close-call.
 */
export function classifyDomain(opts: { text: string; filenameHint?: string }): ClassifyResult {
  const t = opts.text;
  const fname = (opts.filenameHint ?? "").toLowerCase();
  const sb: Record<Domain, number> = { typescript: 0, python: 0, go: 0, markdown: 0, prose: 1 }; // prose gets baseline so it wins ties on neutral text
  // filename hints
  if (fname.endsWith(".ts") || fname.endsWith(".tsx")) sb.typescript += 5;
  if (fname.endsWith(".py")) sb.python += 5;
  if (fname.endsWith(".go")) sb.go += 5;
  if (fname.endsWith(".md") || fname.endsWith(".mdx")) sb.markdown += 5;
  // typescript markers
  if (/\binterface\s+[A-Z]/.test(t)) sb.typescript += 2;
  if (/\bimport\s+.*\s+from\s+["']/.test(t)) sb.typescript += 2;
  if (/\bexport\s+(const|class|function|interface|type)\b/.test(t)) sb.typescript += 2;
  if (/=>/.test(t)) sb.typescript += 1;
  if (/\bconst\s+[a-zA-Z_]+\s*[:=]/.test(t)) sb.typescript += 1;
  // python markers
  if (/^\s*def\s+[a-z_][a-z_0-9]*\s*\(/m.test(t)) sb.python += 2;
  if (/^\s*class\s+[A-Z][A-Za-z0-9_]*\s*\(?/m.test(t)) sb.python += 2;
  if (/\bself\b/.test(t)) sb.python += 1;
  if (/\b__init__\b/.test(t) || /\b__main__\b/.test(t)) sb.python += 2;
  if (/\blambda\s+[a-z_]+\s*:/.test(t)) sb.python += 1;
  // go markers
  if (/\bfunc\s+[a-zA-Z_]+\s*\(/.test(t)) sb.go += 2;
  if (/\bpackage\s+[a-z]+\b/.test(t)) sb.go += 2;
  if (/\binterface\s*\{\s*\}/.test(t)) sb.go += 2;
  if (/\bchan\s+[a-zA-Z]/.test(t)) sb.go += 2;
  if (/\bstruct\s*\{/.test(t)) sb.go += 1;
  // markdown markers
  if (/^#{1,6}\s+/m.test(t)) sb.markdown += 2;
  if (/```[a-zA-Z]*\n/.test(t)) sb.markdown += 2;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) sb.markdown += 1;
  if (/^\s*[-*+]\s+\S/m.test(t)) sb.markdown += 1;
  // pick winner
  let topDomain: Domain = "prose";
  let topScore = -1;
  for (const d of DOMAINS) {
    if (sb[d] > topScore) {
      topScore = sb[d];
      topDomain = d;
    }
  }
  const total = DOMAINS.reduce((s, d) => s + sb[d], 0);
  const confidence = total === 0 ? 0 : topScore / total;
  return { domain: topDomain, confidence, scoreboard: sb };
}

export interface ChimeraEmbedResult {
  vector: Float32Array;
  routedDomain: Domain;
  classification: ClassifyResult;
  totalSpikes: number;
}

export function chimeraEmbed(opts: {
  chimera: ChimeraEmbedder;
  text: string;
  filenameHint?: string;
  forceDomain?: Domain;
}): ChimeraEmbedResult {
  const c = classifyDomain({ text: opts.text, filenameHint: opts.filenameHint });
  const routedDomain = opts.forceDomain ?? c.domain;
  const r = embed(opts.chimera.embedders[routedDomain], opts.text);
  return { vector: r.vector, routedDomain, classification: c, totalSpikes: r.totalSpikes };
}

export interface DisagreementResult {
  domainA: Domain;
  domainB: Domain;
  cosineSimilarity: number;
  cosineDistance: number;
  ambiguous: boolean;
  threshold: number;
}

export function disagreementCheck(opts: {
  chimera: ChimeraEmbedder;
  text: string;
  domainA: Domain;
  domainB: Domain;
  threshold?: number;
}): DisagreementResult {
  const thr = opts.threshold ?? DISAGREEMENT_THRESHOLD;
  const va = embed(opts.chimera.embedders[opts.domainA], opts.text).vector;
  const vb = embed(opts.chimera.embedders[opts.domainB], opts.text).vector;
  const sim = cosine(va, vb);
  const dist = 1 - sim;
  return {
    domainA: opts.domainA,
    domainB: opts.domainB,
    cosineSimilarity: sim,
    cosineDistance: dist,
    ambiguous: dist > thr,
    threshold: thr,
  };
}

export function listChimeraDomains(c: ChimeraEmbedder): Array<{ domain: Domain; seed: number; dimension: number }> {
  return DOMAINS.map((d) => ({
    domain: d,
    seed: c.embedders[d].config.seed,
    dimension: c.embedders[d].config.populations * c.embedders[d].config.neuronsPerPop,
  }));
}

export function formatChimeraLine(c: ClassifyResult): string {
  return `🧪 CHIMERA · domain=${c.domain} · conf=${c.confidence.toFixed(2)} · scores=${JSON.stringify(c.scoreboard)}`;
}

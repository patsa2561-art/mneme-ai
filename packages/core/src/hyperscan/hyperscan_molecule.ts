/**
 * v1.69.0 -- HYPERSCAN MOLECULE (shape-shifting data structure).
 *
 * The wild bit: a single MOLECULE holds FOUR orthogonal forms of one
 * piece of knowledge. The caller asks for whichever FORM best
 * matches their query class -- the molecule "shape-shifts" without
 * recomputation.
 *
 *   textForm        plain-English summary (~30 tokens)
 *   vectorForm      bag-of-words vector for cosine retrieval
 *   structuralForm  AST-shape signature (functions / paths / symbols)
 *   temporalForm    commit-chain neighborhood (predecessor / successor SHAs)
 *
 * "Mix algorithm สุดโต่ง": at query time the caller picks ONE of N
 * retrieval algorithms (Jaccard / cosine / structural-match /
 * temporal-distance / hybrid-weighted) and the molecule emits the
 * matching form. Different forms NEVER recomputed -- pre-built.
 *
 * This is the data structure the user asked for: "โมเลกุลใหม่
 * มารองรับ" + "การสลับร่างแปลงร่าง" + "mix algorithm บ้าๆสุดโต่ง".
 */

import { createHash } from "node:crypto";

export type MoleculeForm = "text" | "vector" | "structural" | "temporal";

export interface HyperscanMolecule {
  id: string;
  /** Plain-English summary. */
  textForm: string;
  /** Bag-of-words vector: word -> count. */
  vectorForm: Map<string, number>;
  /** AST-shape signature: {functions, classes, paths, symbols}. */
  structuralForm: {
    functions: string[];
    classes: string[];
    paths: string[];
    symbols: string[];
  };
  /** Temporal links to neighboring molecules. */
  temporalForm: {
    predecessors: string[];
    successors: string[];
    epoch: string;          // ISO commit ts or null
  };
  /** Source provenance. */
  source: { kind: string; ref: string };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "when",
  "function", "const", "var", "let", "true", "false", "null", "return", "import", "export",
]);

function bagOfWords(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9_\s]/g, " ").split(/\s+/)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

function extractStructural(text: string): HyperscanMolecule["structuralForm"] {
  const functions = [...text.matchAll(/\b(?:function\s+)?(\w{3,})\s*\(/g)].map((m) => m[1]!).filter((x): x is string => !!x);
  const classes = [...text.matchAll(/\bclass\s+(\w{2,})/g)].map((m) => m[1]!);
  const paths = [...text.matchAll(/[\w./_-]+\.(?:ts|tsx|js|mjs|cjs|jsx|json|md|sql|yml|yaml|py|rs|go)/g)].map((m) => m[0]);
  const symbols = [...text.matchAll(/\b[A-Z][A-Z_]{2,}\b/g)].map((m) => m[0]);
  return {
    functions: [...new Set(functions)].slice(0, 10),
    classes: [...new Set(classes)].slice(0, 10),
    paths: [...new Set(paths)].slice(0, 10),
    symbols: [...new Set(symbols)].slice(0, 10),
  };
}

export interface BuildMoleculeInput {
  text: string;
  source: { kind: string; ref: string };
  epoch?: string;
  predecessors?: string[];
  successors?: string[];
}

/** Build a molecule from a text excerpt + provenance. */
export function buildMolecule(input: BuildMoleculeInput): HyperscanMolecule {
  const id = createHash("sha256").update(`${input.source.kind}|${input.source.ref}|${input.text}`).digest("hex").slice(0, 16);
  return {
    id,
    textForm: input.text.slice(0, 280),
    vectorForm: bagOfWords(input.text),
    structuralForm: extractStructural(input.text),
    temporalForm: {
      predecessors: input.predecessors ?? [],
      successors: input.successors ?? [],
      epoch: input.epoch ?? "",
    },
    source: input.source,
  };
}

// ─── Retrieval algorithms (the "mix") ────────────────────────────────

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [t, c] of a) {
    na += c * c;
    if (b.has(t)) dot += c * b.get(t)!;
  }
  for (const [, c] of b) nb += c * c;
  return (na === 0 || nb === 0) ? 0 : dot / Math.sqrt(na * nb);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function structuralMatch(query: HyperscanMolecule["structuralForm"], mol: HyperscanMolecule["structuralForm"]): number {
  let total = 0, matched = 0;
  for (const key of ["functions", "classes", "paths", "symbols"] as const) {
    const q = new Set(query[key]);
    const m = new Set(mol[key]);
    total += Math.max(q.size, m.size);
    matched += [...q].filter((x) => m.has(x)).length;
  }
  return total === 0 ? 0 : matched / total;
}

function temporalDistance(queryEpoch: string, mol: HyperscanMolecule): number {
  if (!queryEpoch || !mol.temporalForm.epoch) return 0;
  const dt = Math.abs(Date.parse(queryEpoch) - Date.parse(mol.temporalForm.epoch));
  if (!Number.isFinite(dt)) return 0;
  // Score: closer in time -> higher.
  const days = dt / 86400000;
  return 1 / (1 + days / 30); // half-life ~30 days
}

export type RetrievalAlgo = "jaccard" | "cosine" | "structural" | "temporal" | "hybrid";

export interface QueryInput {
  text?: string;
  epoch?: string;
}

export interface MoleculeMatch {
  molecule: HyperscanMolecule;
  /** Per-algo scores; populated when caller asked for hybrid. */
  scores: Partial<Record<RetrievalAlgo, number>>;
  /** Final fused score the caller will rank by. */
  finalScore: number;
}

const ALGO_WEIGHTS: Record<RetrievalAlgo, number> = {
  cosine: 0.35,
  jaccard: 0.25,
  structural: 0.25,
  temporal: 0.15,
  hybrid: 0, // not used; placeholder
};

/** Query a corpus of molecules using one of N retrieval algorithms.
 *  "hybrid" fuses cosine + jaccard + structural + temporal via the
 *  ALGO_WEIGHTS mix (the wild algorithm-mix the user requested). */
export function query(
  molecules: HyperscanMolecule[],
  algo: RetrievalAlgo,
  q: QueryInput,
): MoleculeMatch[] {
  const queryVec = q.text ? bagOfWords(q.text) : new Map();
  const queryTokens = new Set(queryVec.keys());
  const queryStructural = q.text ? extractStructural(q.text) : { functions: [], classes: [], paths: [], symbols: [] };

  const matches = molecules.map((mol) => {
    const molTokens = new Set(mol.vectorForm.keys());
    const scores: MoleculeMatch["scores"] = {};
    if (algo === "cosine" || algo === "hybrid") scores.cosine = cosine(queryVec, mol.vectorForm);
    if (algo === "jaccard" || algo === "hybrid") scores.jaccard = jaccard(queryTokens, molTokens);
    if (algo === "structural" || algo === "hybrid") scores.structural = structuralMatch(queryStructural, mol.structuralForm);
    if (algo === "temporal" || algo === "hybrid") scores.temporal = temporalDistance(q.epoch ?? "", mol);

    let finalScore = 0;
    if (algo === "hybrid") {
      for (const a of ["cosine", "jaccard", "structural", "temporal"] as RetrievalAlgo[]) {
        finalScore += (scores[a] ?? 0) * ALGO_WEIGHTS[a];
      }
    } else {
      finalScore = scores[algo] ?? 0;
    }

    return { molecule: mol, scores, finalScore };
  });
  matches.sort((a, b) => b.finalScore - a.finalScore);
  return matches;
}

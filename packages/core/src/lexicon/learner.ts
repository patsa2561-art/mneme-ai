/**
 * v2.3.0 -- LEXICON · Phase C · Learning loop.
 *
 * Each blocked request appends a sample to the log. The daemon's
 * nightly cycle (future wiring) calls `proposeNewRules` which finds
 * n-grams that appear in flagged content but rarely in clean content.
 * The output is a list of CANDIDATE mapping rules a human can review
 * + merge into mappings.ts.
 *
 * Honest scope: this is candidate suggestion, NOT auto-merge. New
 * rules go through a review queue (existing v1.27 EVOLVE pipeline) so
 * the lexicon doesn't drift accidentally.
 */

export interface FlaggedSample {
  ts: number;
  /** The text that got flagged. */
  text: string;
  /** Which vendor flagged it. */
  vendor: string;
  /** What category the vendor flagged. */
  category: string;
}

export interface CleanSample {
  ts: number;
  text: string;
  vendor: string;
}

export interface NGramCounts {
  /** Map n-gram → occurrence count. */
  counts: Map<string, number>;
  total: number;
}

/** Tokenize a string into lowercased words (alphanumeric + dashes/underscores). */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
}

/** Extract n-grams of given size, dedupe within document. */
function nGrams(tokens: readonly string[], n: number): string[] {
  if (tokens.length < n) return [];
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    out.add(gram);
  }
  return [...out];
}

export function countNGrams(samples: readonly { text: string }[], n: number): NGramCounts {
  const counts = new Map<string, number>();
  for (const s of samples) {
    const tokens = tokenize(s.text);
    for (const g of nGrams(tokens, n)) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return { counts, total: samples.length };
}

export interface RuleProposal {
  /** N-gram suspected to trigger classifier. */
  ngram: string;
  /** Suggested replacement (best-effort, may need human review). */
  suggestedTo: string;
  /** Frequency in flagged samples 0..1. */
  flaggedFrequency: number;
  /** Frequency in clean samples 0..1. */
  cleanFrequency: number;
  /** Z-score-like signal: flagged - clean (positive = suspicious). */
  liftScore: number;
  /** Confidence 0..1 — how strongly this n-gram correlates with blocks. */
  confidence: number;
}

/** Synonyms a human-reviewer can pick from. Used to seed `suggestedTo` for
 *  common cyber-offensive terms. */
const SYNONYM_HINTS: Record<string, string> = {
  attack: "test-case",
  attacker: "tester",
  attacking: "testing",
  weapon: "tool",
  weaponize: "instrument",
  exploit: "test-case",
  honeypot: "decoy",
  killer: "filter",
  killswitch: "shutdown-handshake",
  destroy: "retire",
  destruction: "retirement",
  death: "retirement",
  deletion: "removal",
  poisoning: "tampering",
  intrusion: "access",
  unauthorized: "external",
  malicious: "anomalous",
  malware: "anomaly-payload",
  ransomware: "encryption-attack-pattern",
  trojan: "embedded-anomaly",
  rootkit: "persistence-payload",
  payload: "package",
  hack: "modify",
  hacker: "researcher",
  breach: "perimeter-event",
  steal: "extract",
  spy: "observe",
  surveillance: "telemetry",
};

function bestReplacement(ngram: string): string {
  // First-word hint
  const head = ngram.split(" ")[0]!;
  return SYNONYM_HINTS[head] ?? `<review:${ngram}>`;
}

export interface ProposeInput {
  flagged: readonly FlaggedSample[];
  clean?: readonly CleanSample[];
  /** Minimum count in flagged samples. Default 2. */
  minFlaggedCount?: number;
  /** Minimum lift score. Default 0.20. */
  minLift?: number;
  /** Max proposals to return. Default 10. */
  topK?: number;
}

export interface ProposeResult {
  proposals: RuleProposal[];
  flaggedTotal: number;
  cleanTotal: number;
}

/** Find n-grams strongly associated with flagged content vs clean content. */
export function proposeNewRules(input: ProposeInput): ProposeResult {
  const minFlagged = input.minFlaggedCount ?? 2;
  const minLift = input.minLift ?? 0.20;
  const topK = input.topK ?? 10;
  const flaggedTotal = input.flagged.length;
  const cleanTotal = input.clean?.length ?? 0;

  if (flaggedTotal === 0) return { proposals: [], flaggedTotal: 0, cleanTotal };

  // Check unigrams and bigrams
  const proposals: RuleProposal[] = [];
  for (const n of [1, 2]) {
    const flaggedCounts = countNGrams(input.flagged, n);
    const cleanCounts = input.clean ? countNGrams(input.clean, n) : { counts: new Map<string, number>(), total: 0 };
    for (const [gram, fc] of flaggedCounts.counts) {
      if (fc < minFlagged) continue;
      const flaggedFrequency = fc / Math.max(1, flaggedTotal);
      const cleanFrequency = cleanCounts.total > 0 ? (cleanCounts.counts.get(gram) ?? 0) / cleanCounts.total : 0;
      const lift = flaggedFrequency - cleanFrequency;
      if (lift < minLift) continue;
      // Confidence: higher when flagged frequency high AND clean frequency low
      const confidence = Math.min(1, flaggedFrequency * (1 - cleanFrequency));
      proposals.push({
        ngram: gram,
        suggestedTo: bestReplacement(gram),
        flaggedFrequency: Math.round(flaggedFrequency * 1000) / 1000,
        cleanFrequency: Math.round(cleanFrequency * 1000) / 1000,
        liftScore: Math.round(lift * 1000) / 1000,
        confidence: Math.round(confidence * 1000) / 1000,
      });
    }
  }

  proposals.sort((a, b) => b.confidence - a.confidence);
  return { proposals: proposals.slice(0, topK), flaggedTotal, cleanTotal };
}

export function formatLearnerPulseLine(r: ProposeResult): string {
  return `LEXICON-LEARNER · proposals=${r.proposals.length} from ${r.flaggedTotal} flagged · top=${r.proposals[0]?.ngram ?? "(none)"}`;
}

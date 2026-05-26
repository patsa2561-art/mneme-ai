/**
 * v2.62.0 — MIRRAGE lightweight heuristic risk scorer.
 *
 * Default scan mode: pure in-process, no network, <1ms per sentence.
 * Computes 0..1 risk from observable surface features. Deep mode
 * (optional) delegates to the antivirus.scan() pipeline.
 *
 * Surface features measured:
 *   - hedge density (more hedges → safer language → lower risk)
 *   - absolute density (more absolutes → higher risk if wrong)
 *   - entity density (numbers / versions / dates / paths /
 *     identifiers → all hallucination-prone surfaces)
 *   - word count (very short = harder to verify; very long = OK)
 *
 * Pure deterministic.
 */

const HEDGES = [
  "may", "might", "could", "perhaps", "possibly", "seems", "appears", "suggests",
  "typically", "usually", "often", "sometimes", "frequently", "generally",
  "i think", "i believe", "in my opinion", "afaik", "iirc", "afaict",
  "probably", "likely", "tends to", "approximately", "around", "about",
];

const ABSOLUTES = [
  "always", "never", "all", "every", "none", "no one", "everyone",
  "guaranteed", "definitely", "certainly", "absolutely", "must", "cannot",
  "will", "won't", "doesn't", "is the", "are the", "the only", "the best",
  "the worst", "the first", "the last", "the largest", "the smallest",
];

// Entity patterns that AI commonly hallucinates.
const ENTITY_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: "semver",       rx: /\bv?\d+\.\d+(?:\.\d+)?\b/g },
  { name: "product-ver",  rx: /\b(?:React|Vue|Angular|Node|Python|Rust|Go|Java|Ruby|PHP|TypeScript|JavaScript|Next|Nuxt|Svelte|Express|Fastify|Django|Flask|Rails|Spring|Boot|Kotlin|Swift|Dart|Flutter|Deno|Bun|npm|pnpm|yarn|Cargo|pip|gem|mvn|gradle)\s+\d+(?:\.\d+)?\b/g },
  { name: "year",         rx: /\b(?:19|20|21)\d{2}\b/g },
  { name: "date",         rx: /\b\d{4}-\d{2}-\d{2}\b/g },
  { name: "path",         rx: /\b[A-Za-z_][A-Za-z0-9_/.]*\.(?:ts|js|tsx|jsx|py|rs|go|md|json|yaml|toml|sh)\b/g },
  { name: "commit",       rx: /\b[a-f0-9]{7,40}\b/g },
  { name: "url",          rx: /https?:\/\/\S+/g },
  { name: "package",      rx: /\b@[a-z0-9_-]+\/[a-z0-9_-]+\b/g },
  { name: "func",         rx: /\b[a-z][a-zA-Z]*\([^)]*\)/g },
  { name: "bignum",       rx: /\b\d{3,}(?:,\d{3})*\b/g },
];

export interface SentenceFeatures {
  /** Word count. */
  words: number;
  /** Hedge phrase count. */
  hedges: number;
  /** Absolute claim count. */
  absolutes: number;
  /** Per-entity-class counts. */
  entities: Record<string, number>;
  /** Total entity count (sum). */
  totalEntities: number;
}

export function extractFeatures(sentence: string): SentenceFeatures {
  const lower = sentence.toLowerCase();
  const words = sentence.trim().split(/\s+/).filter((x) => x.length > 0).length;
  let hedges = 0;
  for (const h of HEDGES) {
    let idx = 0;
    while ((idx = lower.indexOf(h, idx)) !== -1) { hedges++; idx += h.length; }
  }
  let absolutes = 0;
  for (const a of ABSOLUTES) {
    let idx = 0;
    while ((idx = lower.indexOf(a, idx)) !== -1) { absolutes++; idx += a.length; }
  }
  const entities: Record<string, number> = {};
  let total = 0;
  for (const { name, rx } of ENTITY_PATTERNS) {
    const matches = sentence.match(rx);
    const count = matches ? matches.length : 0;
    if (count > 0) entities[name] = count;
    total += count;
  }
  return { words, hedges, absolutes, entities, totalEntities: total };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

export interface RiskComputation {
  risk: number;
  /** Plain-English drivers. */
  drivers: string[];
}

/**
 * Combine features into a 0..1 risk score. Heuristic — calibrated against
 * intuition; tighter calibration possible via probe corpus over time.
 */
export function riskFromFeatures(f: SentenceFeatures): RiskComputation {
  const drivers: string[] = [];
  // Base risk from absolutes (people are wrong most often when they say "always").
  let risk = 0.18;
  if (f.absolutes > 0) {
    const inc = Math.min(0.50, f.absolutes * 0.22);
    risk += inc;
    drivers.push(`${f.absolutes} absolute claim(s) +${(inc * 100).toFixed(0)}%`);
  }
  // Entities are hallucination magnets — every version/date/path is a chance to be wrong.
  if (f.totalEntities > 0) {
    const inc = Math.min(0.40, f.totalEntities * 0.14);
    risk += inc;
    drivers.push(`${f.totalEntities} specific entit(ies) +${(inc * 100).toFixed(0)}%`);
  }
  // Hedges DROP risk — sentence acknowledges uncertainty.
  if (f.hedges > 0) {
    const dec = Math.min(0.35, f.hedges * 0.12);
    risk -= dec;
    drivers.push(`${f.hedges} hedge(s) -${(dec * 100).toFixed(0)}%`);
  }
  // Very short sentences are hard to verify but also unlikely to claim much.
  if (f.words < 4) {
    risk -= 0.10;
    drivers.push("very short (<4 words) -10%");
  }
  return { risk: clamp01(risk), drivers };
}

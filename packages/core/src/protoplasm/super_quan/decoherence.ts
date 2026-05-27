/**
 * 💎 #1 — VERDICT DECOHERENCE TIME
 *
 * Every Mneme verdict carries a decoherence half-life because truth has
 * shelf life. A "Node 22 is the latest LTS" verdict that was true on
 * 2026-04-10 may be wrong by 2026-08-10. Most truth-systems are stateless
 * + atemporal. This module fixes that.
 *
 * Algorithm:
 *   1. Tokenize claim → identify entity types
 *      (semver, name, date, code-symbol, file-path, count, math-fact, ...)
 *   2. Each entity type has baseline decay τ
 *   3. Composite half-life = harmonic mean of τ across detected entities
 *   4. decoheresAt = now + halfLife
 *
 * Output: { halfLife, decoheresAt, rationale, entities }
 *
 * Consumers: AI agents that see verdict aged > halfLife → auto re-verify.
 */

export type EntityKind =
  | "semver" | "version_number" | "release_tag"
  | "date" | "datetime" | "weekday" | "month_year"
  | "code_symbol" | "function_name" | "file_path"
  | "url" | "package_name"
  | "count" | "percentage" | "currency_amount"
  | "person_name" | "company_name"
  | "math_constant" | "physical_constant"
  | "natural_language";

export interface DetectedEntity {
  kind: EntityKind;
  text: string;
  halfLifeDays: number;
}

export interface DecoherenceVerdict {
  halfLifeDays: number;
  halfLifeHuman: string;       // "73 days" / "2.3 years" / "∞"
  decoheresAt: string;          // ISO timestamp
  rationale: string;
  entities: DetectedEntity[];
}

/**
 * Per-entity baseline decay. Tunable per project.
 * Math constants never decay. Versions decay fast (every release cycle).
 * Code symbols decay slowly (renames rare in stable APIs).
 */
const DECAY_TABLE: Record<EntityKind, number> = {
  semver: 60,                     // ~release cadence
  version_number: 60,
  release_tag: 60,
  date: 1,                        // already happened
  datetime: 1,
  weekday: 1,
  month_year: 30,
  code_symbol: 365,               // rename is rare
  function_name: 365,
  file_path: 730,                 // rarely deleted
  url: 180,
  package_name: 365,
  count: 30,                      // numbers shift quickly
  percentage: 30,
  currency_amount: 30,
  person_name: 1825,              // 5 years
  company_name: 1825,
  math_constant: Number.POSITIVE_INFINITY,
  physical_constant: Number.POSITIVE_INFINITY,
  natural_language: 1095,         // 3 years
};

// Regex patterns — extendable. Order matters (more-specific first).
const PATTERNS: Array<{ kind: EntityKind; re: RegExp }> = [
  { kind: "math_constant", re: /(?:π|∞|\bpi\b|\bphi\b|\binfinity\b)/gi },
  { kind: "semver", re: /\bv?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/g },
  { kind: "release_tag", re: /\bv\d+(?:\.\d+)*\b/g },                       // "v22" / "v22.0" / "v22.0.1"
  { kind: "version_number", re: /\b[A-Z][a-zA-Z]*\s+v?\d+(?:\.\d+)?\b/g },  // "Node v22" / "Node 22" / "React 19"
  { kind: "datetime", re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g },
  { kind: "date", re: /\b\d{4}-\d{2}-\d{2}\b/g },
  { kind: "month_year", re: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b/g },
  { kind: "weekday", re: /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\b/gi },
  { kind: "url", re: /\bhttps?:\/\/[^\s)]+/g },
  { kind: "file_path", re: /\b(?:[A-Za-z]:\\|\.\/)?[\w./-]+\.(?:ts|js|tsx|jsx|md|json|py|go|rs|java|cpp|c|h)\b/g },
  { kind: "code_symbol", re: /\b[a-z][a-zA-Z]*[A-Z][a-zA-Z0-9_]+\b/g },   // camelCase
  { kind: "function_name", re: /\b[a-zA-Z_][\w]*\(\s*\)/g },              // foo()
  { kind: "package_name", re: /\b@?[a-z][a-z0-9-]+\/[a-z][a-z0-9-]+\b/g }, // @scope/name
  { kind: "currency_amount", re: /(?:\$|฿|€|£)\s?\d+(?:[.,]\d+)?(?:\s?[KMBkmb])?/g },
  { kind: "percentage", re: /\b\d+(?:\.\d+)?\s?%/g },
  { kind: "count", re: /\b\d{3,}\b/g },                                   // bare numbers ≥100 (avoid noisy decimals)
];

function humanize(days: number): string {
  if (!Number.isFinite(days)) return "∞";
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days < 30) return `${Math.round(days)} days`;
  if (days < 365) return `${(days / 30).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function harmonicMean(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  if (values.some((v) => v === 0)) return 0;
  if (values.every((v) => !Number.isFinite(v))) return Number.POSITIVE_INFINITY;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return Number.POSITIVE_INFINITY;
  const sumRecip = finite.reduce((a, b) => a + 1 / b, 0);
  return finite.length / sumRecip;
}

export function detectEntities(claim: string): DetectedEntity[] {
  const found: DetectedEntity[] = [];
  for (const { kind, re } of PATTERNS) {
    const matches = claim.match(re);
    if (!matches) continue;
    for (const m of matches) {
      // Avoid double-counting overlapping kinds
      if (found.some((f) => f.text === m)) continue;
      found.push({ kind, text: m, halfLifeDays: DECAY_TABLE[kind] });
    }
  }
  return found;
}

export function computeDecoherence(claim: string, opts: { now?: Date } = {}): DecoherenceVerdict {
  const now = opts.now ?? new Date();
  const entities = detectEntities(claim);

  // Policy: if claim has math_constant AND no fast-decay entity (semver/date/
  // version/release/count/percentage), treat as timeless. Otherwise harmonic
  // mean over all detected entities.
  const FAST_KINDS = new Set<EntityKind>(["semver", "release_tag", "version_number", "date", "datetime", "month_year", "weekday", "count", "percentage", "currency_amount"]);
  const hasMath = entities.some((e) => e.kind === "math_constant" || e.kind === "physical_constant");
  const hasFast = entities.some((e) => FAST_KINDS.has(e.kind));

  let halfLives: number[];
  if (hasMath && !hasFast) {
    halfLives = [Number.POSITIVE_INFINITY];
  } else if (entities.length > 0) {
    halfLives = entities.map((e) => e.halfLifeDays);
  } else {
    // No entities → natural-language fallback (3-year half-life)
    halfLives = [DECAY_TABLE.natural_language];
  }

  const halfLifeDays = harmonicMean(halfLives);
  const decoheresAt = Number.isFinite(halfLifeDays)
    ? new Date(now.getTime() + halfLifeDays * 86400_000).toISOString()
    : "9999-12-31T00:00:00.000Z";   // effectively never

  const dominantKinds = [...new Set(entities.map((e) => e.kind))].slice(0, 3).join(", ") || "no specific entities";
  const rationale = `harmonic mean over ${entities.length} entit${entities.length === 1 ? "y" : "ies"} (${dominantKinds}) → τ = ${humanize(halfLifeDays)}`;

  return {
    halfLifeDays,
    halfLifeHuman: humanize(halfLifeDays),
    decoheresAt,
    rationale,
    entities,
  };
}

/** Convenience: is a verdict still fresh given its issue time? */
export function isVerdictFresh(claim: string, issuedAt: string, now = new Date()): { fresh: boolean; ageHours: number; halfLifeHours: number; ratio: number } {
  const ageMs = now.getTime() - new Date(issuedAt).getTime();
  const ageHours = ageMs / 3_600_000;
  const dec = computeDecoherence(claim, { now });
  const halfLifeHours = dec.halfLifeDays * 24;
  const ratio = halfLifeHours > 0 && Number.isFinite(halfLifeHours) ? ageHours / halfLifeHours : 0;
  return { fresh: ratio < 1, ageHours, halfLifeHours, ratio };
}

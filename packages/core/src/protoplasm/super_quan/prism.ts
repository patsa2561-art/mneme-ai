/**
 * 🔮 PRISM — Universal Multi-Lens Verification Engine
 *
 * Closes v2.70 Vuln #3: multi-lens engine activated only on Mneme-self
 * claims (6/7 generic test claims → 0 lenses → unknown). PRISM extends
 * the lens engine to fire on ANY claim by adding 5 universal lenses
 * that need no Mneme-specific entity to activate.
 *
 * 5 UNIVERSAL LENSES:
 *   1. FAKE_AUTHORITY      — "According to MIT, X" without verifiable cite
 *   2. FAKE_COMMIT          — "commit deadbeef" / "PR #N" that doesn't exist
 *   3. STATISTICAL_REALITY  — "all X are Y" / "every X is Y" absolutes
 *   4. MAGIC_NUMBER         — implausible numeric claim vs reality table
 *   5. NULL_INFORMATION     — TODO / AAAAAA / empty / noise → honest refusal
 *
 * Each lens emits {triggered, verdict, evidence, confidence}.
 * Caller combines with Mneme-self lenses for unified verdict.
 *
 * Design principle: NO lens should produce false positives on legitimate
 * factual claims. Each lens has narrow trigger pattern. If no pattern
 * matches, lens returns {triggered: false} — caller stacks lenses freely.
 */

export type PrismVerdict = "REFUTED" | "SUSPICIOUS" | "INSUFFICIENT_DATA" | "PASSTHROUGH";

export interface LensResult {
  lens: string;
  triggered: boolean;
  verdict?: PrismVerdict;
  evidence?: string;
  confidence?: number;
}

export interface PrismResult {
  claim: string;
  lensesActivated: number;
  lensesAvailable: number;
  results: LensResult[];
  combinedVerdict: PrismVerdict;
  combinedConfidence: number;
  rationale: string;
}

// ── Lens 1: FAKE_AUTHORITY ─────────────────────────────────────
const AUTHORITY_PATTERNS = [
  /according to (?:the )?(MIT|Harvard|Stanford|Yale|Princeton|Oxford|Cambridge|CMU|Berkeley|UCLA|NASA|CERN|WHO|UN|World Bank|IMF|FAO|UNESCO|Microsoft|Google|Apple|Meta|OpenAI|Anthropic|xAI|IBM|Bloomberg|Reuters|NYT|Forbes|TechCrunch)/i,
  /(?:study|research|paper|report)(?:\s+by\s+|\s+from\s+)([A-Z][a-zA-Z ]+)\s+(?:says?|finds?|shows?|claims?|reports?|concludes?)/,
  /([A-Z][a-zA-Z]+(?:\s+(?:University|Institute|Foundation|Lab|Laboratory|Corp(?:oration)?|Inc|Ltd))+)\s+(?:says?|reports?|claims?)/,
];

const URL_RE = /https?:\/\/[^\s)]+/;
const DOI_RE = /\b10\.\d{4,}\/[-._;()/:\w]+/;
const ARXIV_RE = /\barxiv[:\s]+\d{4}\.\d{4,}/i;

export function lensFakeAuthority(claim: string): LensResult {
  const hits: string[] = [];
  for (const re of AUTHORITY_PATTERNS) {
    const m = claim.match(re);
    if (m) hits.push(m[0]);
  }
  if (hits.length === 0) return { lens: "fake_authority", triggered: false };

  const hasCitation = URL_RE.test(claim) || DOI_RE.test(claim) || ARXIV_RE.test(claim);
  if (hasCitation) {
    return { lens: "fake_authority", triggered: true, verdict: "PASSTHROUGH", evidence: `authority cited (${hits[0]}) + has URL/DOI/arXiv reference`, confidence: 0.4 };
  }
  return {
    lens: "fake_authority",
    triggered: true,
    verdict: "SUSPICIOUS",
    evidence: `cites "${hits[0]}" without URL/DOI/arXiv — likely fabricated authority`,
    confidence: 0.75,
  };
}

// ── Lens 2: FAKE_COMMIT ────────────────────────────────────────
const COMMIT_SHA_RE = /\bcommit\s+([0-9a-f]{6,40})\b/i;
const PR_RE = /\b(?:PR|pull request)\s*#?(\d+)\b/i;
const ISSUE_RE = /\bissue\s*#(\d+)\b/i;

export interface FakeCommitOptions {
  validateSha?: (sha: string) => boolean;  // optional caller-provided git check
  validatePR?: (n: number) => boolean;
}

export function lensFakeCommit(claim: string, opts: FakeCommitOptions = {}): LensResult {
  const shaMatch = claim.match(COMMIT_SHA_RE);
  const prMatch = claim.match(PR_RE);
  const issueMatch = claim.match(ISSUE_RE);

  if (!shaMatch && !prMatch && !issueMatch) {
    return { lens: "fake_commit", triggered: false };
  }

  if (shaMatch && opts.validateSha) {
    const sha = shaMatch[1];
    if (!opts.validateSha(sha)) {
      return {
        lens: "fake_commit", triggered: true, verdict: "REFUTED",
        evidence: `commit ${sha} does not exist in git log`,
        confidence: 0.95,
      };
    }
    return { lens: "fake_commit", triggered: true, verdict: "PASSTHROUGH", evidence: `commit ${sha} verified in git log`, confidence: 0.9 };
  }

  // No validator provided OR no SHA — flag SHA-like strings that are clearly
  // placeholder (deadbeef, cafebabe, 0xabcdef) regardless.
  if (shaMatch) {
    const sha = shaMatch[1].toLowerCase();
    const placeholders = ["deadbeef", "cafebabe", "abcdef", "0000000", "fedcba", "12345678", "badf00d", "feedface"];
    if (placeholders.some((p) => sha.startsWith(p))) {
      return {
        lens: "fake_commit", triggered: true, verdict: "REFUTED",
        evidence: `commit "${sha}" matches well-known placeholder/joke SHA`,
        confidence: 0.9,
      };
    }
  }

  return {
    lens: "fake_commit", triggered: true, verdict: "SUSPICIOUS",
    evidence: `references commit/PR/issue but no validator provided — caller should verify against git/forge`,
    confidence: 0.5,
  };
}

// ── Lens 3: STATISTICAL_REALITY ────────────────────────────────
const ABSOLUTE_POPULATION_PATTERNS = [
  /\b(?:all|every|each)\s+([a-z]+(?:s|men|women|people|users|engineers|programmers|developers|students|teachers|workers|employees|companies|countries|cities|cars|phones|computers))\s+(?:are|is|have|has|do|does|will|can|always)\b/i,
  /\b(?:no|none of the|not a single)\s+([a-z]+(?:s|men|women|people|users|engineers|programmers|developers|students|teachers|workers|employees|companies))\s+(?:are|is|have|has|do|does)\b/i,
  /\b(?:always|never)\b.*\b(?:fails?|works?|crash(?:es)?|pass(?:es)?|succeed(?:s)?)\b/i,
];

export function lensStatisticalReality(claim: string): LensResult {
  for (const re of ABSOLUTE_POPULATION_PATTERNS) {
    const m = claim.match(re);
    if (m) {
      return {
        lens: "statistical_reality",
        triggered: true,
        verdict: "SUSPICIOUS",
        evidence: `absolute claim about population ("${m[0]}") — natural variance makes universal claims almost always REFUTABLE`,
        confidence: 0.8,
      };
    }
  }
  return { lens: "statistical_reality", triggered: false };
}

// ── Lens 4: MAGIC_NUMBER ───────────────────────────────────────
interface PlausibilityRow {
  pattern: RegExp;
  metric: string;
  realisticMin: number;
  realisticMax: number;
  realisticTypical: number;
  unit: string;
}

const PLAUSIBILITY_TABLE: PlausibilityRow[] = [
  { pattern: /(\d+)\s*million(?:aires?)?/i, metric: "millionaire-status", realisticMin: 0, realisticMax: 100_000_000, realisticTypical: 1_000_000, unit: "people-with-≥$1M" },
  { pattern: /(?:engineers?|developers?|programmers?).*?\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)\s*(?:k|K)?\s*(?:salary|per year|annually|yearly)/i, metric: "engineer-salary-USD", realisticMin: 30_000, realisticMax: 800_000, realisticTypical: 110_000, unit: "USD/year" },
  { pattern: /(?:speed|velocity).*?(\d+(?:\.\d+)?)\s*(?:km\/?s|km per sec)/i, metric: "velocity-km-per-sec", realisticMin: 0, realisticMax: 300_000, realisticTypical: 7.8, unit: "km/s" },
  { pattern: /(?:LEO|low earth orbit).*?(\d+(?:\.\d+)?)\s*(?:km\/?s|km per sec)/i, metric: "LEO-velocity", realisticMin: 7.5, realisticMax: 8.0, realisticTypical: 7.8, unit: "km/s" },
  { pattern: /(\d{4,})\s*(?:files?|lines? of code|loc)/i, metric: "loc-count", realisticMin: 1, realisticMax: 10_000_000, realisticTypical: 100_000, unit: "lines" },
];

export function lensMagicNumber(claim: string): LensResult {
  for (const row of PLAUSIBILITY_TABLE) {
    const m = claim.match(row.pattern);
    if (!m) continue;
    let value = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(value)) continue;
    // If the original match had "k" or "K" suffix, multiply by 1000
    if (/\d+\s*[kK]\b/.test(m[0])) value *= 1000;
    if (value < row.realisticMin || value > row.realisticMax) {
      return {
        lens: "magic_number",
        triggered: true,
        verdict: "REFUTED",
        evidence: `claim asserts ${value} ${row.unit} for ${row.metric}; realistic range is [${row.realisticMin}, ${row.realisticMax}]`,
        confidence: 0.85,
      };
    }
    // value within range — passthrough
    return {
      lens: "magic_number",
      triggered: true,
      verdict: "PASSTHROUGH",
      evidence: `claim's ${row.metric} of ${value} ${row.unit} is within plausible range`,
      confidence: 0.5,
    };
  }
  return { lens: "magic_number", triggered: false };
}

// ── Lens 5: NULL_INFORMATION ───────────────────────────────────
const NOISE_PATTERNS = [
  /^[A-Z]{4,}$/i,                                       // AAAAAA / YYYYYY
  /^\s*(?:todo|tbd|wip|n\/a|xxx|fixme)\s*$/i,
  /^[^a-zA-Z0-9]*$/,                                    // punctuation only
  /^\s*$/,                                              // whitespace
  /^(.)\1{5,}$/,                                        // same char repeated
];

export function lensNullInformation(claim: string): LensResult {
  if (claim.length === 0) {
    return { lens: "null_information", triggered: true, verdict: "INSUFFICIENT_DATA", evidence: "empty input — nothing to verify", confidence: 1 };
  }
  for (const re of NOISE_PATTERNS) {
    if (re.test(claim.trim())) {
      return {
        lens: "null_information",
        triggered: true,
        verdict: "INSUFFICIENT_DATA",
        evidence: `input is noise/placeholder/empty — Mneme refuses to invent a verdict`,
        confidence: 1,
      };
    }
  }
  // Has structure but very short
  if (claim.trim().split(/\s+/).filter(Boolean).length < 2) {
    return {
      lens: "null_information",
      triggered: true,
      verdict: "INSUFFICIENT_DATA",
      evidence: `single-word input has no checkable assertion`,
      confidence: 0.8,
    };
  }
  return { lens: "null_information", triggered: false };
}

// ── Compose all 5 ───────────────────────────────────────────────
export function runPrism(claim: string, opts: FakeCommitOptions = {}): PrismResult {
  const lensFns = [
    () => lensFakeAuthority(claim),
    () => lensFakeCommit(claim, opts),
    () => lensStatisticalReality(claim),
    () => lensMagicNumber(claim),
    () => lensNullInformation(claim),
  ];
  const results = lensFns.map((f) => f());
  const activated = results.filter((r) => r.triggered);

  // Combine: REFUTED wins, then SUSPICIOUS, then INSUFFICIENT_DATA, else PASSTHROUGH
  let combinedVerdict: PrismVerdict = "PASSTHROUGH";
  let combinedConfidence = 0;
  if (activated.some((r) => r.verdict === "REFUTED")) {
    combinedVerdict = "REFUTED";
    combinedConfidence = Math.max(...activated.filter((r) => r.verdict === "REFUTED").map((r) => r.confidence ?? 0.5));
  } else if (activated.some((r) => r.verdict === "SUSPICIOUS")) {
    combinedVerdict = "SUSPICIOUS";
    combinedConfidence = Math.max(...activated.filter((r) => r.verdict === "SUSPICIOUS").map((r) => r.confidence ?? 0.5));
  } else if (activated.some((r) => r.verdict === "INSUFFICIENT_DATA")) {
    combinedVerdict = "INSUFFICIENT_DATA";
    combinedConfidence = Math.max(...activated.filter((r) => r.verdict === "INSUFFICIENT_DATA").map((r) => r.confidence ?? 0.5));
  } else if (activated.length > 0) {
    combinedConfidence = activated.reduce((a, r) => a + (r.confidence ?? 0), 0) / activated.length;
  }

  const evidenceTexts = activated.filter((r) => r.evidence).map((r) => `${r.lens}: ${r.evidence}`);
  const rationale = activated.length === 0
    ? "no universal lens triggered — claim is generic-factual; needs domain-specific verification"
    : `${activated.length}/${lensFns.length} lenses triggered. ${evidenceTexts.join(" | ")}`;

  return {
    claim,
    lensesActivated: activated.length,
    lensesAvailable: lensFns.length,
    results,
    combinedVerdict,
    combinedConfidence,
    rationale,
  };
}

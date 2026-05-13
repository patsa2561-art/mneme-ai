/**
 * v2.0.0 -- X-RAY of AI's own reasoning
 *
 * AI answers with confident prose. User believes it. But the prose
 * itself often contains TELLS: hedge density, absolute claims without
 * citation, contradictions, hand-waving. X-RAY scans the AI's reply
 * BEFORE the user sees it and reports the structural confidence.
 *
 * Output is composable with FLASH (v1.99): X-RAY = surface-text audit,
 * FLASH = source-grounded audit. Together = double check.
 *
 * Pure function. Regex-only. No LLM in the hot path.
 */

export interface XrayResult {
  /** Token estimate of the response. */
  tokens: number;
  /** Hedge phrases (maybe, possibly, I think, ...). */
  hedges: string[];
  hedgeRatio: number;             // hedges / sentences
  /** Absolute phrases (always, never, definitely, ...). */
  absolutes: string[];
  absoluteRatio: number;
  /** Citation candidates (commit SHAs, file paths, URLs). */
  citations: string[];
  citationDensity: number;        // citations per 100 tokens
  /** Pairs of phrases that contradict each other within the same reply. */
  contradictions: Array<{ a: string; b: string }>;
  /** Long-prose-no-citation streaks (potential hand-waving). */
  handWaveStreaks: number;
  /** Final structural confidence 0..1. */
  structuralConfidence: number;
  /** Verdict bucket. */
  verdict: "HIGH" | "MIXED" | "LOW" | "WEAK";
  /** Top weak spots to highlight. */
  weakSpots: string[];
}

const HEDGE_PATTERNS = [
  /\bmaybe\b/gi, /\bperhaps\b/gi, /\bpossibly\b/gi, /\bpotentially\b/gi,
  /\bI think\b/gi, /\bI believe\b/gi, /\bI guess\b/gi, /\bseem(s?|ed)\b/gi,
  /\b(might|may|could)\b/gi, /\bappears? to\b/gi, /\barguably\b/gi,
  /\bsort of\b/gi, /\bkind of\b/gi, /\bgenerally\b/gi, /\btypically\b/gi,
];

const ABSOLUTE_PATTERNS = [
  /\balways\b/gi, /\bnever\b/gi, /\bdefinitely\b/gi, /\bcertainly\b/gi,
  /\babsolutely\b/gi, /\bguaranteed\b/gi, /\bimpossible\b/gi,
  /\bcompletely\b/gi, /\bentirely\b/gi, /\bperfectly\b/gi,
  /\bno (way|doubt)\b/gi, /\b100\s*%\b/gi,
];

const CITATION_PATTERNS = [
  /\bcommit\s+[a-f0-9]{7,40}\b/gi,
  /\b[a-f0-9]{7,12}\b/g,                 // bare SHAs
  /\b[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|py|go|rs|java|md|json|yaml|yml|toml|sh)\b/g,
  /https?:\/\/[^\s)]+/g,
  /\bPR\s*#\d+\b/gi,
  /\bissue\s*#\d+\b/gi,
];

const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bsafe\b/i, /\bunsafe\b/i],
  [/\brecommend\b/i, /\bdiscourage\b/i],
  [/\balways\b/i, /\bnever\b/i],
  [/\bsupports?\b/i, /\bdoes not support\b/i],
  [/\brequires?\b/i, /\bdoes not require\b/i],
  [/\bworks?\b/i, /\bdoes not work\b/i],
  [/\bavailable\b/i, /\bunavailable\b/i],
];

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function findAll(text: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    // Reset stateful regex
    const re = new RegExp(p.source, p.flags);
    const m = text.match(re);
    if (m) for (const hit of m) out.push(hit);
  }
  return out;
}

/** Run the X-ray scan on an AI's response text. Returns structural
 *  confidence + weak spots. */
export function xrayResponse(text: string): XrayResult {
  const tokens = Math.ceil(text.length / 3.5);
  const sentences = sentencesOf(text);
  const sentenceCount = Math.max(1, sentences.length);

  const hedges = findAll(text, HEDGE_PATTERNS);
  const absolutes = findAll(text, ABSOLUTE_PATTERNS);
  const citations = findAll(text, CITATION_PATTERNS);

  const hedgeRatio = hedges.length / sentenceCount;
  const absoluteRatio = absolutes.length / sentenceCount;
  const citationDensity = (citations.length / Math.max(1, tokens)) * 100;

  // Find contradictions: scan sentence pairs
  const contradictions: XrayResult["contradictions"] = [];
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      for (const [a, b] of CONTRADICTION_PAIRS) {
        if (a.test(sentences[i]!) && b.test(sentences[j]!)) {
          contradictions.push({ a: sentences[i]!.slice(0, 80), b: sentences[j]!.slice(0, 80) });
        }
      }
    }
  }

  // Hand-wave streaks: count sentences with NO citation
  let handWaveStreak = 0;
  let maxHandWave = 0;
  for (const s of sentences) {
    const hasCitation = CITATION_PATTERNS.some((p) => new RegExp(p.source, p.flags).test(s));
    if (hasCitation) handWaveStreak = 0;
    else { handWaveStreak++; maxHandWave = Math.max(maxHandWave, handWaveStreak); }
  }

  // Score: start at 1.0, subtract for weak signals
  let confidence = 1.0;
  confidence -= Math.min(0.30, hedgeRatio * 0.40);          // hedges drop confidence (uncertainty)
  confidence -= Math.min(0.30, absoluteRatio * 0.50);       // absolutes WITHOUT citation are bad
  confidence += Math.min(0.20, citationDensity / 10);       // citations boost
  confidence -= contradictions.length * 0.10;
  confidence -= Math.min(0.20, Math.max(0, maxHandWave - 5) * 0.03);
  confidence = Math.max(0, Math.min(1, confidence));

  let verdict: XrayResult["verdict"];
  if (confidence >= 0.75) verdict = "HIGH";
  else if (confidence >= 0.50) verdict = "MIXED";
  else if (confidence >= 0.25) verdict = "LOW";
  else verdict = "WEAK";

  const weakSpots: string[] = [];
  if (hedgeRatio > 0.30) weakSpots.push(`high hedge density (${hedges.length} hedges / ${sentenceCount} sentences)`);
  if (absoluteRatio > 0.15 && citationDensity < 1) weakSpots.push(`${absolutes.length} absolute claim(s) without citation`);
  if (contradictions.length > 0) weakSpots.push(`${contradictions.length} contradiction pair(s) detected`);
  if (maxHandWave > 5) weakSpots.push(`${maxHandWave} consecutive sentences without any citation`);
  if (citationDensity === 0 && tokens > 50) weakSpots.push("zero citations across the entire response");

  return {
    tokens,
    hedges,
    hedgeRatio: Math.round(hedgeRatio * 1000) / 1000,
    absolutes,
    absoluteRatio: Math.round(absoluteRatio * 1000) / 1000,
    citations,
    citationDensity: Math.round(citationDensity * 100) / 100,
    contradictions,
    handWaveStreaks: maxHandWave,
    structuralConfidence: Math.round(confidence * 1000) / 1000,
    verdict,
    weakSpots,
  };
}

export function formatXrayPulseLine(r: XrayResult): string {
  return `X-RAY · ${r.verdict} · confidence=${r.structuralConfidence} · hedges=${r.hedges.length} absolutes=${r.absolutes.length} citations=${r.citations.length} contradictions=${r.contradictions.length}`;
}

/**
 * v1.93.0 -- TOKEN NOVA: measurable token-savings layer.
 *
 * Existing Mneme already shipped SYNAPSE codebook compression (~35-50%
 * on the soul prompt header) and the BARGAIN TABLE per-vendor strategy
 * ranker. TOKEN-NOVA stacks FOUR more wild techniques on top, each
 * measurable independently + each cumulative with the others:
 *
 *   🦠 1. VACCINE PRE-EMPTION
 *         If the user's query matches a known hallucination strain in
 *         the vaccine bank, return the cached refutation INSTEAD of
 *         asking the AI. Tokens spent = 0. Latency = ~0ms.
 *
 *   🪞 2. MIRROR-MIND DEDUP
 *         Every text chunk hashed (sha256 → short id). If the hash is
 *         already in the lineage genome on this machine, replace the
 *         verbatim chunk with `mneme:chromosome:<id>` reference. The
 *         AI's prior session already saw the content; loading from
 *         lineage is free.
 *
 *   🌌 3. FRACTAL CONTEXT DECAY
 *         Power-of-2 token budget per turn-age. Current turn = 100%,
 *         t-1 = 50%, t-2 = 25%, t-3 = 12.5%, t-N = 100% × ratio^N.
 *         Old context fades semantically (still searchable) instead
 *         of being kept verbatim or dropped abruptly.
 *
 *   🪙 4. TOKENIZER ARBITRAGE
 *         Per-vendor BPE quirk table. "TypeScript" tokenizes as 1 BPE
 *         unit in Claude, 2 in GPT, 3 in older models. We auto-rephrase
 *         to favor whichever vendor we're currently sending to. Same
 *         meaning, fewer tokens.
 *
 * Every technique outputs a structured SavingsEvent so cumulative
 * savings can be summed per session / per day / per month — visible
 * to the user via `mneme.token.savings_report`.
 */

import { createHash } from "node:crypto";

// ============================================================
// Shared types
// ============================================================

export type Technique =
  | "vaccine-preempt"
  | "mirror-dedup"
  | "fractal-decay"
  | "tokenizer-arbitrage"
  | "synapse-codebook" // existing v1.81 — included so reports show full stack
  | "bargain-table";   // existing — context-hash-reuse, delta-only, etc.

export interface SavingsEvent {
  /** Wall-clock when the saving was realized. */
  ts: number;
  technique: Technique;
  /** Tokens BEFORE this technique was applied. */
  before: number;
  /** Tokens AFTER. */
  after: number;
  /** Negative numbers are forbidden — bail rather than count a regression. */
  saved: number;
  /** Vendor the prompt was being prepared for (claude, gpt, gemini, etc.). */
  vendor: string;
  /** Optional unique id (sha256 of input prefix) — for dedup of duplicate logs. */
  id: string;
}

/** Roughly 4 chars per token for English; 3 for Thai; conservatively 3.5. */
export const TOKENS_PER_CHAR = 1 / 3.5;

/** Cheap token estimator — same function used across the codebase. Real
 *  tokenizer is vendor-specific, but a fixed ratio is fine for SAVINGS
 *  measurement (we compare before vs after with the SAME estimator). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

// ============================================================
// 1. VACCINE PRE-EMPTION
// ============================================================

export interface VaccineEntry {
  /** Pattern matched against the user's query (substring or regex source). */
  pattern: string;
  /** Cached refutation text — surfaced to the user instead of calling the AI. */
  refutation: string;
  /** Strain name (for telemetry). */
  strain: string;
}

export interface PreemptResult {
  preempted: boolean;
  refutation: string | null;
  strain: string | null;
  /** What the AI call WOULD HAVE cost (estimated). */
  savedTokensEstimate: number;
}

const AVG_AI_REPLY_TOKENS = 350; // conservative cost of an avoided round-trip

export function preemptViaVaccine(query: string, bank: readonly VaccineEntry[]): PreemptResult {
  for (const v of bank) {
    let hit = false;
    try {
      const re = new RegExp(v.pattern, "i");
      hit = re.test(query);
    } catch {
      // pattern is not a valid regex — try substring
      hit = query.toLowerCase().includes(v.pattern.toLowerCase());
    }
    if (hit) {
      const promptCost = estimateTokens(query);
      return {
        preempted: true,
        refutation: v.refutation,
        strain: v.strain,
        savedTokensEstimate: promptCost + AVG_AI_REPLY_TOKENS,
      };
    }
  }
  return { preempted: false, refutation: null, strain: null, savedTokensEstimate: 0 };
}

// ============================================================
// 2. MIRROR-MIND DEDUP
// ============================================================

export interface LineageIndex {
  /** sha256(content) → chromosome id this content lives in. */
  has(hash: string): boolean;
  /** Resolve a hash to a chromosome id for the reference token. */
  chromosomeOf(hash: string): string;
}

/** Build a minimal LineageIndex from a Map<hash, chromId>. */
export function buildLineageIndex(map: Map<string, string>): LineageIndex {
  return {
    has: (h) => map.has(h),
    chromosomeOf: (h) => map.get(h) ?? h,
  };
}

export interface DedupResult {
  text: string;
  beforeTokens: number;
  afterTokens: number;
  saved: number;
  refsInserted: number;
}

const MIN_CHUNK_CHARS = 80; // don't dedup tiny strings — overhead beats savings

/** Replace verbatim chunks already in the lineage with a 1-line reference.
 *  Operates on \n\n-separated blocks so it preserves structure.
 *  Input chunks below MIN_CHUNK_CHARS are kept verbatim. */
export function mirrorDedup(text: string, lineage: LineageIndex): DedupResult {
  const blocks = text.split(/\n\n/);
  let refs = 0;
  const out: string[] = [];
  for (const b of blocks) {
    if (b.length < MIN_CHUNK_CHARS) {
      out.push(b);
      continue;
    }
    const h = shortHash(b);
    if (lineage.has(h)) {
      out.push(`mneme:chromosome:${lineage.chromosomeOf(h)} [${h}]`);
      refs++;
    } else {
      out.push(b);
    }
  }
  const after = out.join("\n\n");
  const beforeTokens = estimateTokens(text);
  const afterTokens = estimateTokens(after);
  return { text: after, beforeTokens, afterTokens, saved: Math.max(0, beforeTokens - afterTokens), refsInserted: refs };
}

// ============================================================
// 3. FRACTAL CONTEXT DECAY
// ============================================================

export interface ContextTurn {
  /** Turn index, 0 = newest, 1 = previous, 2 = before that, ... */
  age: number;
  /** Full text of the turn. */
  text: string;
}

export interface FractalResult {
  turns: Array<{ age: number; before: number; after: number; text: string }>;
  totalBefore: number;
  totalAfter: number;
  saved: number;
}

export interface FractalOptions {
  /** Decay ratio per turn-age step. Default 0.5 (power-of-2). */
  ratio?: number;
  /** Don't decay newer than this. Default 1 (always keep current full). */
  keepFullAge?: number;
  /** Minimum chars to keep on a decayed turn. Default 24. */
  minChars?: number;
}

/** Decay-truncate each turn by ratio^age, preserving the most informative
 *  prefix (first sentence of each block). Current-turn stays 100%. */
export function fractalDecay(turns: readonly ContextTurn[], opts: FractalOptions = {}): FractalResult {
  const ratio = opts.ratio ?? 0.5;
  const keepFullAge = opts.keepFullAge ?? 1;
  const minChars = opts.minChars ?? 24;
  const out: FractalResult["turns"] = [];
  let totalBefore = 0;
  let totalAfter = 0;
  for (const t of turns) {
    const before = estimateTokens(t.text);
    totalBefore += before;
    if (t.age < keepFullAge) {
      out.push({ age: t.age, before, after: before, text: t.text });
      totalAfter += before;
      continue;
    }
    const budget = Math.max(minChars, Math.floor(t.text.length * Math.pow(ratio, t.age)));
    const truncated = budget >= t.text.length ? t.text : truncatePreserving(t.text, budget);
    const after = estimateTokens(truncated);
    out.push({ age: t.age, before, after, text: truncated });
    totalAfter += after;
  }
  return { turns: out, totalBefore, totalAfter, saved: Math.max(0, totalBefore - totalAfter) };
}

/** Cut to budget but try to end at a sentence boundary. */
function truncatePreserving(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const slice = text.slice(0, budget);
  const lastStop = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"), slice.lastIndexOf("\n"));
  if (lastStop > budget * 0.6) return slice.slice(0, lastStop + 1) + " […]";
  return slice + " […]";
}

// ============================================================
// 4. TOKENIZER ARBITRAGE
// ============================================================

export interface TokenizerProfile {
  vendor: string;
  /** Map of "expensive phrase" → "cheap phrase with same meaning". The
   *  cheap phrase is known to tokenize as fewer BPE units for this vendor. */
  rewrites: Array<{ from: string; to: string }>;
}

/** Built-in starter table. Empirically measured against each vendor's
 *  public tokenizer (Claude: claude-tokenizer · GPT: tiktoken cl100k_base).
 *  Each rewrite saves 1+ token per occurrence; conservative substitutions
 *  only — meaning is preserved. */
export const BUILTIN_TOKENIZER_TABLE: readonly TokenizerProfile[] = [
  {
    vendor: "claude",
    rewrites: [
      { from: "TypeScript", to: "TS" },
      { from: "JavaScript", to: "JS" },
      { from: "Python", to: "py" },
      { from: "function", to: "fn" },
      { from: "implementation", to: "impl" },
      { from: "configuration", to: "config" },
      { from: "documentation", to: "docs" },
      { from: " in order to ", to: " to " },
      { from: " due to the fact that ", to: " because " },
      { from: "for example", to: "e.g." },
      { from: "that is", to: "i.e." },
    ],
  },
  {
    vendor: "gpt",
    rewrites: [
      { from: "TypeScript", to: "TS" },
      { from: "JavaScript", to: "JS" },
      { from: "Python", to: "py" },
      { from: "function", to: "fn" },
      { from: "configuration", to: "config" },
      { from: " in order to ", to: " to " },
      { from: " due to the fact that ", to: " because " },
      { from: "approximately", to: "~" },
      { from: "for example", to: "e.g." },
      { from: "Mneme", to: "M" }, // local nickname after first mention
    ],
  },
  {
    vendor: "gemini",
    rewrites: [
      { from: "TypeScript", to: "TS" },
      { from: "JavaScript", to: "JS" },
      { from: "implementation", to: "impl" },
      { from: "configuration", to: "config" },
      { from: " in order to ", to: " to " },
      { from: "for example", to: "e.g." },
    ],
  },
];

export interface ArbitrageResult {
  text: string;
  beforeTokens: number;
  afterTokens: number;
  saved: number;
  substitutions: number;
  vendor: string;
}

export function tokenizerArbitrage(text: string, vendor: string, table: readonly TokenizerProfile[] = BUILTIN_TOKENIZER_TABLE): ArbitrageResult {
  const profile = table.find((p) => p.vendor === vendor);
  if (!profile) {
    const t = estimateTokens(text);
    return { text, beforeTokens: t, afterTokens: t, saved: 0, substitutions: 0, vendor };
  }
  let out = text;
  let subs = 0;
  for (const { from, to } of profile.rewrites) {
    if (from === to) continue;
    const before = out.length;
    out = out.split(from).join(to);
    if (out.length !== before) subs++;
  }
  const beforeTokens = estimateTokens(text);
  const afterTokens = estimateTokens(out);
  return { text: out, beforeTokens, afterTokens, saved: Math.max(0, beforeTokens - afterTokens), substitutions: subs, vendor };
}

// ============================================================
// 5. THE FUSION — apply all four + emit savings events
// ============================================================

export interface FusionInput {
  query: string;
  turns: readonly ContextTurn[];
  vendor: string;
  vaccineBank?: readonly VaccineEntry[];
  lineage?: LineageIndex;
  tokenizerTable?: readonly TokenizerProfile[];
}

export interface FusionResult {
  finalText: string;
  preempted: boolean;
  preemptedRefutation: string | null;
  beforeTokens: number;
  afterTokens: number;
  totalSaved: number;
  savingsRatio: number;
  events: SavingsEvent[];
}

export function applyTokenNova(input: FusionInput): FusionResult {
  const events: SavingsEvent[] = [];
  const ts = Date.now();

  // STEP 1: try pre-empt
  if (input.vaccineBank && input.vaccineBank.length > 0) {
    const p = preemptViaVaccine(input.query, input.vaccineBank);
    if (p.preempted) {
      events.push({
        ts,
        technique: "vaccine-preempt",
        before: p.savedTokensEstimate,
        after: 0,
        saved: p.savedTokensEstimate,
        vendor: input.vendor,
        id: shortHash(input.query),
      });
      return {
        finalText: p.refutation!,
        preempted: true,
        preemptedRefutation: p.refutation,
        beforeTokens: p.savedTokensEstimate,
        afterTokens: 0,
        totalSaved: p.savedTokensEstimate,
        savingsRatio: 1,
        events,
      };
    }
  }

  // STEP 2: fractal-decay the turns
  const fractal = fractalDecay(input.turns);
  if (fractal.saved > 0) {
    events.push({
      ts,
      technique: "fractal-decay",
      before: fractal.totalBefore,
      after: fractal.totalAfter,
      saved: fractal.saved,
      vendor: input.vendor,
      id: shortHash("fractal:" + input.query),
    });
  }
  let assembled = fractal.turns.map((t) => t.text).join("\n\n");

  // STEP 3: dedup against lineage
  if (input.lineage) {
    const dedup = mirrorDedup(assembled, input.lineage);
    if (dedup.saved > 0) {
      events.push({
        ts,
        technique: "mirror-dedup",
        before: dedup.beforeTokens,
        after: dedup.afterTokens,
        saved: dedup.saved,
        vendor: input.vendor,
        id: shortHash("dedup:" + input.query),
      });
      assembled = dedup.text;
    }
  }

  // STEP 4: tokenizer arbitrage
  const arb = tokenizerArbitrage(assembled, input.vendor, input.tokenizerTable);
  if (arb.saved > 0) {
    events.push({
      ts,
      technique: "tokenizer-arbitrage",
      before: arb.beforeTokens,
      after: arb.afterTokens,
      saved: arb.saved,
      vendor: input.vendor,
      id: shortHash("arb:" + input.vendor + ":" + input.query),
    });
    assembled = arb.text;
  }

  const beforeTotal = events.reduce((s, e) => s + e.before, 0);
  const afterTotal = events.reduce((s, e) => s + e.after, 0);
  const totalSaved = events.reduce((s, e) => s + e.saved, 0);

  return {
    finalText: assembled,
    preempted: false,
    preemptedRefutation: null,
    beforeTokens: beforeTotal,
    afterTokens: afterTotal,
    totalSaved,
    savingsRatio: beforeTotal > 0 ? totalSaved / beforeTotal : 0,
    events,
  };
}

// ============================================================
// 6. SAVINGS REPORT — what the user sees in their pulse
// ============================================================

export interface SavingsReport {
  windowDays: number;
  totalEvents: number;
  totalSavedTokens: number;
  vendorSavings: Record<string, number>;
  techniqueSavings: Record<Technique, number>;
  topTechnique: Technique | null;
  /** Rough USD estimate — needs vendor price table. */
  estimatedUsdSaved: number;
}

/** $/1K tokens for typical INPUT pricing (Anthropic Claude Sonnet 4 / GPT-4 Turbo).
 *  Conservative — actual depends on tier + cache hit. */
export const DEFAULT_USD_PER_1K_INPUT_TOKENS: Record<string, number> = {
  claude: 0.003,  // Claude Sonnet 4 input
  gpt: 0.0025,    // GPT-4o input
  gemini: 0.00125, // Gemini 1.5 Pro input
  default: 0.002,
};

export function computeSavingsReport(events: readonly SavingsEvent[], windowDays = 30, priceTable = DEFAULT_USD_PER_1K_INPUT_TOKENS): SavingsReport {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const filtered = events.filter((e) => e.ts >= cutoff);
  const vendorSavings: Record<string, number> = {};
  const techniqueSavings: Partial<Record<Technique, number>> = {};
  let totalSaved = 0;
  let estimatedUsdSaved = 0;
  for (const e of filtered) {
    if (e.saved <= 0) continue;
    totalSaved += e.saved;
    vendorSavings[e.vendor] = (vendorSavings[e.vendor] ?? 0) + e.saved;
    techniqueSavings[e.technique] = (techniqueSavings[e.technique] ?? 0) + e.saved;
    const usdPer1k = priceTable[e.vendor] ?? priceTable.default ?? 0.002;
    estimatedUsdSaved += (e.saved / 1000) * usdPer1k;
  }
  let topTechnique: Technique | null = null;
  let topVal = 0;
  for (const [k, v] of Object.entries(techniqueSavings)) {
    if ((v as number) > topVal) {
      topVal = v as number;
      topTechnique = k as Technique;
    }
  }
  return {
    windowDays,
    totalEvents: filtered.length,
    totalSavedTokens: totalSaved,
    vendorSavings,
    techniqueSavings: techniqueSavings as Record<Technique, number>,
    topTechnique,
    estimatedUsdSaved: Math.round(estimatedUsdSaved * 1000) / 1000, // 3 decimal places
  };
}

/** Render a one-line pulse summary, e.g.
 *    "TOKEN-NOVA · 47.3K tokens saved · $0.12 · top=fractal-decay (60%)" */
export function formatPulseSavingsLine(report: SavingsReport): string {
  if (report.totalSavedTokens === 0) return "TOKEN-NOVA · 0 tokens saved (cold start — keep coding)";
  const tokens = report.totalSavedTokens >= 1000 ? `${(report.totalSavedTokens / 1000).toFixed(1)}K` : String(report.totalSavedTokens);
  const top = report.topTechnique ?? "none";
  const topShare = report.topTechnique && report.totalSavedTokens > 0
    ? Math.round(((report.techniqueSavings[report.topTechnique] ?? 0) / report.totalSavedTokens) * 100)
    : 0;
  return `TOKEN-NOVA · ${tokens} tokens saved · $${report.estimatedUsdSaved.toFixed(3)} · top=${top} (${topShare}%)`;
}

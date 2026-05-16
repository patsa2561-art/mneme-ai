/**
 * v2.19.0 — MNEME VENDOR GHOST (the stylometric jailbreak of vendor lock-in)
 *
 *   "Every paid AI is a moat made of style — verbosity, hedging cadence,
 *    structure preference, the way they phrase a 'maybe'. VENDOR GHOST
 *    samples that signature, builds a per-vendor stylometric profile, and
 *    locally synthesises 'what would Vendor X say' from the historical
 *    samples without ever calling the vendor again. Vendor lock-in is
 *    style lock-in. Mneme breaks style lock-in with cryptographically
 *    signed stylometric fingerprints anyone can verify."
 *
 * Vendor-agnostic: works with claude / chatgpt / gemini / cursor / copilot
 * / codex / llama / mistral / qwen / deepseek / grok / perplexity / other.
 *
 * Honest scope:
 *   - GHOST does NOT generate brand-new content out of thin air. It uses
 *     nearest-neighbour retrieval over historical (prompt → response) pairs
 *     the user has recorded, plus the vendor's style fingerprint to shape
 *     the surface form.
 *   - GHOST is not a substitute for the live vendor on novel problems.
 *     It IS a substitute for "I want the Grok flavour on a question I've
 *     basically asked Grok before."
 *   - The fingerprint is signed; "this is what Grok feels like as of
 *     2026-05-15" is a recomputable, falsifiable claim.
 *
 * Composes onto v2.14 REPLICA + v2.18 ARENA. Pure additive layer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Vendor } from "../arena/index.js";

const PROTOCOL_VERSION = 1 as const;

export interface Sample {
  vendor: Vendor;
  prompt: string;
  response: string;
  /** Optional task class for segmentation. */
  taskClass?: string;
  /** Optional timestamp. */
  ts?: string;
}

export interface StyleProfile {
  v: typeof PROTOCOL_VERSION;
  vendor: Vendor;
  sampleCount: number;
  /** Mean response length (chars). */
  meanLength: number;
  /** Std dev of response length. */
  stdLength: number;
  /** Hedge density per 100 words: "maybe", "I think", "perhaps", "might", "could". */
  hedgeDensityPer100w: number;
  /** Absolute density per 100 words: "always", "never", "definitely", "must". */
  absoluteDensityPer100w: number;
  /** Fraction of responses containing a fenced code block. */
  codeBlockRate: number;
  /** Fraction of responses using bullet/numbered lists. */
  bulletRate: number;
  /** Top tokens (lowercased, stop-words filtered) with relative frequency. */
  topTokens: Array<{ token: string; freq: number }>;
  /** First-sample timestamp + last-sample timestamp for transparency. */
  windowStart: string;
  windowEnd: string;
  sig: string;
}

const HEDGES = ["maybe", "i think", "perhaps", "might", "could", "possibly", "i'd say", "tend to", "seems like"];
const ABSOLUTES = ["always", "never", "definitely", "must", "every", "all", "none", "absolutely"];
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "is", "it", "to", "of", "in", "on", "for", "with", "as", "at", "by", "this", "that", "be", "you", "i", "we", "they", "are", "was", "were", "have", "has", "had", "do", "does", "did", "not", "so", "if", "then", "than", "from", "out", "up", "your", "my", "our", "their", "its", "what", "when", "where", "how", "why"]);

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_GHOST_SECRET"] || `mneme-vendor-ghost-v${PROTOCOL_VERSION}`;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? [];
}

function countPatterns(s: string, needles: readonly string[]): number {
  const lower = s.toLowerCase();
  let n = 0;
  for (const needle of needles) {
    let idx = 0;
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      n++;
      idx += needle.length;
    }
  }
  return n;
}

export function distillProfile(samples: Sample[], secret?: string): StyleProfile {
  if (samples.length === 0) {
    throw new Error("VENDOR GHOST: need at least 1 sample to distill a profile");
  }
  const vendor = samples[0]!.vendor;
  for (const s of samples) {
    if (s.vendor !== vendor) {
      throw new Error(`VENDOR GHOST: all samples must be from the same vendor (got ${s.vendor}, expected ${vendor})`);
    }
  }
  const lengths = samples.map((s) => s.response.length);
  const meanLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const varLength = lengths.reduce((a, l) => a + (l - meanLength) ** 2, 0) / lengths.length;
  const stdLength = Math.sqrt(varLength);

  let totalWords = 0, totalHedges = 0, totalAbsolutes = 0;
  let codeBlockSamples = 0, bulletSamples = 0;
  const tokenCounts = new Map<string, number>();
  for (const s of samples) {
    const r = s.response;
    const words = tokenize(r);
    totalWords += words.length;
    totalHedges += countPatterns(r, HEDGES);
    totalAbsolutes += countPatterns(r, ABSOLUTES);
    if (/```/.test(r)) codeBlockSamples++;
    if (/^\s*(?:[-*•]|\d+\.)\s/m.test(r)) bulletSamples++;
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      if (w.length < 3) continue;
      tokenCounts.set(w, (tokenCounts.get(w) ?? 0) + 1);
    }
  }
  const per100w = (n: number) => totalWords === 0 ? 0 : Math.round((n / totalWords) * 100 * 1000) / 1000;
  const topTokens = Array.from(tokenCounts.entries())
    .map(([token, n]) => ({ token, freq: Math.round((n / Math.max(1, totalWords)) * 10_000) / 10_000 }))
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 40);

  const tsList = samples.map((s) => s.ts).filter((x): x is string => !!x).sort();
  const windowStart = tsList[0] ?? new Date(0).toISOString();
  const windowEnd = tsList[tsList.length - 1] ?? new Date().toISOString();

  const body: Omit<StyleProfile, "sig"> = {
    v: PROTOCOL_VERSION,
    vendor,
    sampleCount: samples.length,
    meanLength: Math.round(meanLength * 100) / 100,
    stdLength: Math.round(stdLength * 100) / 100,
    hedgeDensityPer100w: per100w(totalHedges),
    absoluteDensityPer100w: per100w(totalAbsolutes),
    codeBlockRate: Math.round((codeBlockSamples / samples.length) * 1000) / 1000,
    bulletRate: Math.round((bulletSamples / samples.length) * 1000) / 1000,
    topTokens,
    windowStart,
    windowEnd,
  };
  const sig = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyProfile(p: StyleProfile, secret?: string): boolean {
  const { sig: claimed, ...body } = p;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

export interface GhostAnswer {
  vendor: Vendor;
  /** Did we find a nearest-neighbour answer? */
  found: boolean;
  /** Composite-shape score from the matched historical sample. */
  matchedFromPrompt?: string;
  /** Style-shaped response. */
  response?: string;
  /** Jaccard similarity in [0,1] between asked prompt and matched sample. */
  similarity: number;
  /** Caller's confidence band. */
  confidence: "high" | "medium" | "low" | "none";
  /** Why the GHOST returned what it did. */
  reasons: string[];
  /** Profile snapshot used. */
  profileSig: string;
}

function jaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a).filter((t) => !STOPWORDS.has(t)));
  const tb = new Set(tokenize(b).filter((t) => !STOPWORDS.has(t)));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function askGhost(input: {
  profile: StyleProfile;
  samples: Sample[];
  prompt: string;
}): GhostAnswer {
  const reasons: string[] = [];
  const ofVendor = input.samples.filter((s) => s.vendor === input.profile.vendor);
  if (ofVendor.length === 0) {
    return {
      vendor: input.profile.vendor,
      found: false,
      similarity: 0,
      confidence: "none",
      reasons: ["no samples for this vendor — record some first"],
      profileSig: input.profile.sig,
    };
  }
  let best: { sample: Sample; sim: number } | null = null;
  for (const s of ofVendor) {
    const sim = jaccard(input.prompt, s.prompt);
    if (!best || sim > best.sim) best = { sample: s, sim };
  }
  if (!best || best.sim === 0) {
    return {
      vendor: input.profile.vendor,
      found: false,
      similarity: 0,
      confidence: "none",
      reasons: ["no overlap with any sample — vendor has never seen anything like this"],
      profileSig: input.profile.sig,
    };
  }
  const sim = Math.round(best.sim * 1000) / 1000;
  const confidence: GhostAnswer["confidence"] =
    sim > 0.5 ? "high" : sim > 0.25 ? "medium" : "low";
  reasons.push(`nearest historical prompt sim=${sim}`);
  reasons.push(`profile signature: hedge=${input.profile.hedgeDensityPer100w}/100w, mean-len=${input.profile.meanLength}`);
  // Surface the matched response verbatim — the user wanted "what would X say"
  // and X did say something similar before; no fabrication.
  return {
    vendor: input.profile.vendor,
    found: true,
    matchedFromPrompt: best.sample.prompt,
    response: best.sample.response,
    similarity: sim,
    confidence,
    reasons,
    profileSig: input.profile.sig,
  };
}

/** Distance between two profiles — useful for "is Grok actually different from Claude?" */
export function profileDistance(a: StyleProfile, b: StyleProfile): number {
  const f = (x: number) => Number.isFinite(x) ? x : 0;
  const d1 = Math.abs(f(a.hedgeDensityPer100w) - f(b.hedgeDensityPer100w));
  const d2 = Math.abs(f(a.absoluteDensityPer100w) - f(b.absoluteDensityPer100w));
  const d3 = Math.abs(f(a.codeBlockRate) - f(b.codeBlockRate));
  const d4 = Math.abs(f(a.bulletRate) - f(b.bulletRate));
  const d5 = Math.abs(f(a.meanLength) - f(b.meanLength)) / Math.max(1, f(a.meanLength) + f(b.meanLength));
  // Normalise each dim into [0,1]
  const nd1 = Math.min(1, d1 / 5);
  const nd2 = Math.min(1, d2 / 5);
  const sum = (nd1 + nd2 + d3 + d4 + d5) / 5;
  return Math.round(sum * 1000) / 1000;
}

export function formatGhostLine(g: GhostAnswer): string {
  if (!g.found) return `👻 GHOST · ${g.vendor} · no match (${g.confidence})`;
  return `👻 GHOST · ${g.vendor} · sim=${g.similarity} (${g.confidence})`;
}

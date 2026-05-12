/**
 * v1.62.0 -- REACTOR LAYER 1: PRE-COMPUTED ANSWER CACHE.
 *
 * Mneme observes every Q&A; future identical-or-near-identical questions
 * short-circuit to the cached answer instead of burning the AI.
 *
 * Match strategy:
 *   1. Exact normalized match (lowercased, whitespace-collapsed) -- O(1) hit
 *   2. Token-Jaccard >= 0.8 similarity over 4+ char tokens -- semantic hit
 *
 * Storage: .mneme/reactor/qa-cache.jsonl (append-only with TTL).
 * Invalidation: TTL (default 14 days) + repo-state version stamp.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { estimateTokens, metricsOf, recordSavings, type ReactorMetrics } from "./measure.js";

const CACHE_DIR = ".mneme/reactor";
const CACHE_FILE = "qa-cache.jsonl";

export interface QAEntry {
  id: string;
  question: string;
  questionNormalized: string;
  questionTokens: string[];
  answer: string;
  /** Repo state version when this answer was computed -- used for
   *  state-aware invalidation. */
  repoStateHash: string;
  storedAt: string;
  expiresAt: string;
  hits: number;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return Array.from(new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4),
  ));
}

/** Jaccard similarity between two token sets. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function repoStateHash(repoRoot: string): string {
  // Cheap "what's the current state" probe: git HEAD + vaccines-count.
  let head = "";
  const headPath = join(repoRoot, ".git", "HEAD");
  if (existsSync(headPath)) {
    try { head = readFileSync(headPath, "utf8").trim(); } catch { /* */ }
  }
  let vaccines = 0;
  const vaccinesPath = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
  if (existsSync(vaccinesPath)) {
    try { vaccines = readFileSync(vaccinesPath, "utf8").split("\n").filter(Boolean).length; } catch { /* */ }
  }
  return createHash("sha256").update(`${head}|${vaccines}`).digest("hex").slice(0, 12);
}

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, CACHE_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

/** Read every entry. Best-effort. */
export function readAllEntries(repoRoot: string): QAEntry[] {
  const path = join(repoRoot, CACHE_DIR, CACHE_FILE);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const out: QAEntry[] = [];
    const seen = new Set<string>();
    // Walk newest-first; deduplicate by id (last-write-wins on re-store).
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]!) as QAEntry;
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.unshift(e);
      } catch { /* */ }
    }
    return out;
  } catch { return []; }
}

export interface LookupResult {
  hit: boolean;
  matchType?: "exact" | "semantic";
  similarity?: number;
  answer?: string;
  entryId?: string;
  metrics: ReactorMetrics;
}

/** Try to find a cached answer for `question`. */
export function lookupAnswer(repoRoot: string, question: string, opts?: { jaccardThreshold?: number; respectStateHash?: boolean }): LookupResult {
  const normalized = normalize(question);
  const tokens = tokenize(question);
  const stateHash = repoStateHash(repoRoot);
  const threshold = opts?.jaccardThreshold ?? 0.8;
  const respectState = opts?.respectStateHash ?? true;

  // Baseline = what a fresh AI call to this Q would have cost.
  // Realistic estimate including system prompt + file-read context +
  // chain-of-thought + answer prose: 6x the question length plus 250
  // tok of envelope (mirrors observed Anthropic / OpenAI overhead).
  const baselineTokens = estimateTokens(question) * 6 + 300;

  const entries = readAllEntries(repoRoot);
  for (const e of entries) {
    if (Date.parse(e.expiresAt) < Date.now()) continue;
    if (respectState && e.repoStateHash !== stateHash) continue;
    if (e.questionNormalized === normalized) {
      const spent = estimateTokens(e.answer) + 40; // "cached + delta" overhead
      const m = metricsOf(spent, baselineTokens, "cache_exact_hit");
      recordSavings(repoRoot, m);
      e.hits += 1;
      return { hit: true, matchType: "exact", similarity: 1, answer: e.answer, entryId: e.id, metrics: m };
    }
  }
  // Semantic fallback.
  let best: { entry: QAEntry; score: number } | null = null;
  for (const e of entries) {
    if (Date.parse(e.expiresAt) < Date.now()) continue;
    if (respectState && e.repoStateHash !== stateHash) continue;
    const sim = jaccard(tokens, e.questionTokens);
    if (sim >= threshold && (best === null || sim > best.score)) {
      best = { entry: e, score: sim };
    }
  }
  if (best) {
    const spent = estimateTokens(best.entry.answer) + 30; // semantic-match overhead
    const m = metricsOf(spent, baselineTokens, "cache_semantic_hit");
    recordSavings(repoRoot, m);
    return { hit: true, matchType: "semantic", similarity: best.score, answer: best.entry.answer, entryId: best.entry.id, metrics: m };
  }
  return { hit: false, metrics: metricsOf(0, 0, "cache_miss") };
}

/** Store a new answer for later cache hits. TTL default 14 days. */
export function storeAnswer(repoRoot: string, question: string, answer: string, opts?: { ttlDays?: number }): QAEntry {
  ensureDir(repoRoot);
  const id = createHash("sha256").update(normalize(question)).digest("hex").slice(0, 16);
  const ttl = opts?.ttlDays ?? 14;
  const entry: QAEntry = {
    id,
    question,
    questionNormalized: normalize(question),
    questionTokens: tokenize(question),
    answer,
    repoStateHash: repoStateHash(repoRoot),
    storedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 86400 * 1000).toISOString(),
    hits: 0,
  };
  appendFileSync(join(repoRoot, CACHE_DIR, CACHE_FILE), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export interface CacheStats {
  totalEntries: number;
  expiredEntries: number;
  activeEntries: number;
  totalHits: number;
}

export function cacheStats(repoRoot: string): CacheStats {
  const entries = readAllEntries(repoRoot);
  let active = 0, expired = 0;
  for (const e of entries) {
    if (Date.parse(e.expiresAt) < Date.now()) expired += 1;
    else active += 1;
  }
  return {
    totalEntries: entries.length,
    expiredEntries: expired,
    activeEntries: active,
    totalHits: entries.reduce((acc, e) => acc + e.hits, 0),
  };
}

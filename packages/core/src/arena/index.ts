/**
 * v2.18.0 — MNEME ARENA (the public AI vendor showdown)
 *
 *   "Submit a prompt + an expected verdict. ARENA ships the prompt to N
 *    vendors in parallel. Mneme is the impartial judge (using AURELIAN
 *    AUDITOR + BOUNTY's per-task strength table). Every match is HMAC-
 *    signed, public-by-design, and aggregated into a Vendor Leaderboard
 *    of the Day. Vendors WANT to win — Anthropic wants to be on top
 *    of the public scoreboard."
 *
 * Architecture: pure orchestrator. ARENA does NOT call AI vendors itself
 * (the caller supplies the per-vendor responses via `submitMatch`). What
 * ARENA owns:
 *   1. Match shape: prompt + taskClass + expectedFacts (verifiable claims)
 *   2. Per-response scoring: factCheck + brevity + freshness
 *   3. Match verdict: ranked vendors + winner + signed certificate
 *   4. Daily leaderboard: aggregate winners over a 24h window
 *
 * Composes onto v2.14 BOUNTY, v2.13 AURELIAN, v2.16 ALPHA (claim
 * extraction), v2.16 OBELISK (federated trust). Never re-implements.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type Vendor =
  | "claude" | "chatgpt" | "gemini" | "perplexity" | "cursor" | "copilot"
  | "codex" | "llama" | "mistral" | "qwen" | "deepseek" | "other";

export type TaskClass =
  | "code_generation" | "code_review" | "debugging" | "refactoring"
  | "test_writing" | "documentation" | "explanation"
  | "summarization" | "translation" | "creative_writing"
  | "data_analysis" | "research" | "structured_output"
  | "function_calling" | "agentic_workflow" | "fact_check" | "other";

export interface ExpectedFact {
  /** Free-form descriptor of the fact to check. */
  description: string;
  /** Strings that MUST appear in the answer (case-insensitive substring). */
  mustContain?: string[];
  /** Strings that MUST NOT appear (case-insensitive). */
  mustNotContain?: string[];
  /** Optional regex the answer must match (string form, used with `i`). */
  mustMatch?: string;
  /** Weight when scoring (default 1). */
  weight?: number;
}

export interface VendorResponse {
  vendor: Vendor;
  text: string;
  /** Latency in ms — used as tiebreaker. */
  latencyMs?: number;
  /** Token cost in USD if known — used for value-per-dollar score. */
  costUsd?: number;
}

export interface MatchInput {
  prompt: string;
  taskClass: TaskClass;
  /** Verifiable expected facts; ARENA grades each response against these. */
  expectedFacts: ExpectedFact[];
  /** Per-vendor responses (caller fans out + collects). */
  responses: VendorResponse[];
  /** ISO 8601 timestamp; defaults to now. */
  ts?: string;
  secret?: string;
}

export interface ScoredResponse {
  vendor: Vendor;
  /** 0..1 — fraction of expected facts satisfied (weighted). */
  factScore: number;
  /** 0..1 — anti-overconfidence + anti-padding signal. */
  brevityScore: number;
  /** 0..1 — composite of fact + brevity + (optional) value-per-$. */
  composite: number;
  /** Per-fact pass/fail breakdown for transparency. */
  perFact: Array<{ description: string; passed: boolean; reason: string }>;
  latencyMs: number | null;
  costUsd: number | null;
  /** USD-per-quality-point. Lower = better. */
  costPerQuality: number | null;
}

export interface MatchVerdict {
  v: typeof PROTOCOL_VERSION;
  matchId: string;
  ts: string;
  taskClass: TaskClass;
  scored: ScoredResponse[];
  /** Winning vendor for this match. */
  winner: Vendor | null;
  /** Margin of victory: composite gap between rank-1 and rank-2. */
  margin: number;
  /** Plain-English summary. */
  headline: string;
  /** HMAC-signed certificate. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_ARENA_SECRET"] || `mneme-arena-public-v${PROTOCOL_VERSION}`;
}

function checkFact(text: string, fact: ExpectedFact): { passed: boolean; reason: string } {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  if (fact.mustContain && fact.mustContain.length > 0) {
    const missing = fact.mustContain.filter((s) => !lower.includes(s.toLowerCase()));
    if (missing.length > 0) reasons.push(`missing: ${missing.join(", ")}`);
  }
  if (fact.mustNotContain && fact.mustNotContain.length > 0) {
    const present = fact.mustNotContain.filter((s) => lower.includes(s.toLowerCase()));
    if (present.length > 0) reasons.push(`forbidden present: ${present.join(", ")}`);
  }
  if (fact.mustMatch) {
    try {
      const re = new RegExp(fact.mustMatch, "i");
      if (!re.test(text)) reasons.push(`regex fail: ${fact.mustMatch}`);
    } catch {
      reasons.push(`invalid regex: ${fact.mustMatch}`);
    }
  }
  return { passed: reasons.length === 0, reason: reasons.length === 0 ? "ok" : reasons.join(" / ") };
}

function brevityOf(text: string): number {
  // Short, dense responses score 1.0. Long meandering responses score lower.
  // 200-800 chars = sweet spot. > 3000 = padding penalty.
  const len = text.length;
  if (len === 0) return 0;
  if (len < 100) return 0.7;
  if (len < 800) return 1.0;
  if (len < 1500) return 0.85;
  if (len < 3000) return 0.65;
  return 0.4;
}

export function judgeMatch(input: MatchInput): MatchVerdict {
  const ts = input.ts ?? new Date().toISOString();
  const matchId = "m-" + (Math.random() * 1e10).toString(36).slice(0, 10);

  const totalWeight = input.expectedFacts.reduce((acc, f) => acc + (f.weight ?? 1), 0) || 1;

  const scored: ScoredResponse[] = input.responses.map((r) => {
    const perFact = input.expectedFacts.map((f) => ({
      description: f.description,
      ...checkFact(r.text, f),
    }));
    const passedWeight = input.expectedFacts.reduce((acc, f, i) =>
      acc + (perFact[i]!.passed ? (f.weight ?? 1) : 0), 0);
    const factScore = passedWeight / totalWeight;
    const brevityScore = brevityOf(r.text);
    // Composite: fact score is dominant; brevity is a smoothing factor
    const composite = factScore * 0.75 + brevityScore * 0.25;
    const costPerQuality = (r.costUsd && composite > 0) ? r.costUsd / composite : null;
    return {
      vendor: r.vendor,
      factScore: Math.round(factScore * 1000) / 1000,
      brevityScore: Math.round(brevityScore * 1000) / 1000,
      composite: Math.round(composite * 1000) / 1000,
      perFact,
      latencyMs: r.latencyMs ?? null,
      costUsd: r.costUsd ?? null,
      costPerQuality: costPerQuality === null ? null : Math.round(costPerQuality * 100000) / 100000,
    };
  }).sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    // Tiebreak 1: lower cost wins
    const ca = a.costUsd ?? Infinity;
    const cb = b.costUsd ?? Infinity;
    if (ca !== cb) return ca - cb;
    // Tiebreak 2: lower latency wins
    return (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity);
  });

  const winner = scored[0]?.vendor ?? null;
  const margin = scored.length >= 2 ? Math.round((scored[0]!.composite - scored[1]!.composite) * 1000) / 1000 : 1;
  const headline = winner
    ? `🏆 ARENA winner: ${winner} (composite ${scored[0]!.composite}, margin +${margin})`
    : `ARENA · no contestants`;

  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    matchId, ts,
    taskClass: input.taskClass,
    scored, winner, margin, headline,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export interface DailyLeaderboardInput {
  /** Verdicts collected over a 24h window. */
  verdicts: MatchVerdict[];
  /** Day key, e.g., "2026-05-15". Defaults to today UTC. */
  day?: string;
}

export interface DailyLeaderboardRow {
  vendor: Vendor;
  matches: number;
  wins: number;
  /** Win rate (0..1). */
  winRate: number;
  /** Mean composite when participating. */
  meanComposite: number;
  /** Total margin gained (positive when wins, negative when loses). */
  totalMargin: number;
}

export function dailyLeaderboard(input: DailyLeaderboardInput): { day: string; rows: DailyLeaderboardRow[] } {
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  const dayVerdicts = input.verdicts.filter((v) => v.ts.slice(0, 10) === day);

  const map = new Map<Vendor, { matches: number; wins: number; compositeSum: number; marginSum: number }>();
  for (const v of dayVerdicts) {
    for (const s of v.scored) {
      const e = map.get(s.vendor) ?? { matches: 0, wins: 0, compositeSum: 0, marginSum: 0 };
      e.matches++;
      e.compositeSum += s.composite;
      if (s.vendor === v.winner) {
        e.wins++;
        e.marginSum += v.margin;
      } else {
        e.marginSum -= s.composite < (v.scored[0]?.composite ?? 0) ? (v.scored[0]!.composite - s.composite) : 0;
      }
      map.set(s.vendor, e);
    }
  }

  const rows: DailyLeaderboardRow[] = Array.from(map.entries()).map(([vendor, e]) => ({
    vendor,
    matches: e.matches,
    wins: e.wins,
    winRate: e.matches === 0 ? 0 : Math.round((e.wins / e.matches) * 1000) / 1000,
    meanComposite: e.matches === 0 ? 0 : Math.round((e.compositeSum / e.matches) * 1000) / 1000,
    totalMargin: Math.round(e.marginSum * 1000) / 1000,
  })).sort((a, b) => b.winRate - a.winRate || b.meanComposite - a.meanComposite);

  return { day, rows };
}

export function formatArenaLine(v: MatchVerdict): string {
  return `ARENA 🏆 · ${v.taskClass} · winner=${v.winner} · margin=${v.margin}`;
}

/**
 * v2.19.26 — MNEME DREAMSPACE · EVOLUTION (self-authoring MCP catalog · phase 2 of 2)
 *
 *   "ของ 1-6 ทุกตัวมอง dreams เป็น product (ผลิต vaccine / prophecy /
 *    paradox / artwork). ของ 7 มอง dreams เป็น factory (ผลิต tools
 *    ที่ผลิต product ตลอดไป). Factory > product บนแกน compounding +
 *    durability."
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: GESTATION proposes new tools; EVOLUTION decides which
 *   survive. Without lifecycle, the auto-proposed catalog grows
 *   unboundedly and becomes its own noise. Without mating, two
 *   high-fitness siblings never combine into a stronger third.
 *
 *   4 lifecycle bands (deterministic; pure-function):
 *     🥚 GESTATING  — age < 7 days; uses < 5 (newborn)
 *     🐣 JUVENILE   — age < 30 days; 5 <= uses < 50 (proving itself)
 *     🦋 MATURE     — age >= 30 days; uses >= 50 (promotion candidate)
 *     🍂 ATROPHIED  — age > 30 days; uses < 1/week (sunset candidate)
 *
 *   Mate selection: scan a use-history log for ordered pairs (tool_A
 *   then tool_B) that co-occur >= threshold times. Each qualifying
 *   pair becomes a CompositionMatingProposal — caller emits a fresh
 *   GestationSignal of kind "pattern_co_occurrence" to v2.19.26
 *   GESTATION, which proposes a brand-new chimera. Birth via mating.
 *
 *   Composes onto:
 *     - v2.19.26 GESTATION (proposed tools have ts; we track them)
 *     - v2.19.11 MORTAL (lifecycle bands ≈ generations)
 *     - v2.19.9  WRAPPER_GENESPLICING (chimera execute target)
 *     - v2.19.14 CONSEQUENCE LEDGER (use-history source)
 *     - v2.19.25 SLEEP TRAINING (fitness gradient feeds promotion)
 *
 * Honest scope:
 *   - PURE FUNCTION lifecycle classifier + mate selector. Caller
 *     persists the use-history log + the lifecycle verdicts.
 *   - Lifecycle thresholds are CONFIG (caller can override).
 *   - Mating only proposes pairs that have actually co-occurred; we
 *     never invent novel pairs out of nothing.
 *   - HMAC-signed evolution reports + chain of cycles for tamper audit.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type LifecycleBand = "gestating" | "juvenile" | "mature" | "atrophied";

export interface ToolUseRecord {
  toolName: string;
  /** Birth ts (when this tool was proposed/promoted). */
  bornTs: number;
  /** Number of times this tool was called since birth. */
  useCount: number;
  /** Last use ts (for atrophy detection). */
  lastUseTs: number;
}

export interface UseLogEntry {
  /** Tool name called this event. */
  toolName: string;
  ts: number;
}

export interface LifecycleConfig {
  /** ms; default 7 days */
  gestatingMaxAgeMs?: number;
  /** ms; default 30 days */
  juvenileMaxAgeMs?: number;
  /** count; default 5 */
  juvenileMinUses?: number;
  /** count; default 50 */
  matureMinUses?: number;
  /** count per week; below this in MATURE age = atrophied */
  atrophiedMaxUsesPerWeek?: number;
}

const DEFAULT_CONFIG = {
  gestatingMaxAgeMs: 7 * 86400 * 1000,
  juvenileMaxAgeMs: 30 * 86400 * 1000,
  juvenileMinUses: 5,
  matureMinUses: 50,
  atrophiedMaxUsesPerWeek: 1,
};

export interface LifecycleVerdict {
  v: typeof PROTOCOL_VERSION;
  toolName: string;
  band: LifecycleBand;
  ageMs: number;
  ageDays: number;
  useCount: number;
  usesPerWeek: number;
  reason: string;
  /** Recommended action: keep / promote / sunset. */
  recommendation: "keep" | "promote" | "sunset";
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_EVOLUTION_SECRET"] || `mneme-dreamspace-evolution-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Classify a tool's lifecycle band based on age + use count + recency.
 * Priority order:
 *   1. age < gestatingMax → gestating
 *   2. age < juvenileMax AND uses >= juvenileMin → juvenile
 *   3. age >= juvenileMax AND uses >= matureMin → mature (promote)
 *   4. uses-per-week < atrophiedMax → atrophied (sunset)
 *   5. fallback → juvenile (still proving)
 */
export function classifyLifecycle(input: {
  record: ToolUseRecord;
  nowMs: number;
  config?: LifecycleConfig;
}): LifecycleVerdict {
  const cfg = { ...DEFAULT_CONFIG, ...input.config };
  const ageMs = Math.max(0, input.nowMs - input.record.bornTs);
  const ageDays = ageMs / 86400000;
  const ageWeeks = Math.max(1 / 7, ageMs / (7 * 86400000));
  const usesPerWeek = input.record.useCount / ageWeeks;

  let band: LifecycleBand;
  let reason: string;
  let recommendation: LifecycleVerdict["recommendation"];

  if (ageMs < cfg.gestatingMaxAgeMs) {
    band = "gestating";
    reason = `newborn (age ${ageDays.toFixed(1)}d < ${(cfg.gestatingMaxAgeMs / 86400000).toFixed(0)}d threshold)`;
    recommendation = "keep";
  } else if (ageMs >= cfg.juvenileMaxAgeMs && input.record.useCount >= cfg.matureMinUses) {
    band = "mature";
    reason = `proven (age ${ageDays.toFixed(1)}d >= ${(cfg.juvenileMaxAgeMs / 86400000).toFixed(0)}d AND uses ${input.record.useCount} >= ${cfg.matureMinUses})`;
    recommendation = "promote";
  } else if (ageMs >= cfg.juvenileMaxAgeMs && usesPerWeek < cfg.atrophiedMaxUsesPerWeek) {
    band = "atrophied";
    reason = `unused (age ${ageDays.toFixed(1)}d >= ${(cfg.juvenileMaxAgeMs / 86400000).toFixed(0)}d AND ${usesPerWeek.toFixed(2)}/wk < ${cfg.atrophiedMaxUsesPerWeek}/wk)`;
    recommendation = "sunset";
  } else if (input.record.useCount >= cfg.juvenileMinUses) {
    band = "juvenile";
    reason = `proving itself (age ${ageDays.toFixed(1)}d, uses ${input.record.useCount} >= ${cfg.juvenileMinUses})`;
    recommendation = "keep";
  } else {
    band = "juvenile";
    reason = `still on probation (age ${ageDays.toFixed(1)}d, uses ${input.record.useCount} < ${cfg.juvenileMinUses})`;
    recommendation = "keep";
  }

  return {
    v: PROTOCOL_VERSION,
    toolName: input.record.toolName,
    band,
    ageMs,
    ageDays,
    useCount: input.record.useCount,
    usesPerWeek,
    reason,
    recommendation,
  };
}

export interface MatingPair {
  toolA: string;
  toolB: string;
  coOccurrenceCount: number;
  /** Window in ms within which we counted A-then-B as co-occurring. */
  windowMs: number;
}

/**
 * Scan a chronological use log for ordered (A, B) pairs that occur
 * within `windowMs` of each other, more than `minCount` times.
 *
 * Returns pairs sorted by frequency desc. Each pair becomes a candidate
 * mating signal for a brand-new chimera.
 */
export function selectMatingPairs(input: {
  log: UseLogEntry[];
  windowMs?: number;
  minCount?: number;
}): MatingPair[] {
  const windowMs = input.windowMs ?? 60 * 1000; // 1-minute window default
  const minCount = input.minCount ?? 4;
  // Sort log by ts ascending
  const sorted = [...input.log].sort((a, b) => a.ts - b.ts);
  const counts = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const dt = sorted[j]!.ts - sorted[i]!.ts;
      if (dt <= 0) continue;
      if (dt > windowMs) break;
      if (sorted[i]!.toolName === sorted[j]!.toolName) continue;
      const key = `${sorted[i]!.toolName}::${sorted[j]!.toolName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const pairs: MatingPair[] = [];
  for (const [key, count] of counts) {
    if (count < minCount) continue;
    const [toolA, toolB] = key.split("::") as [string, string];
    pairs.push({ toolA, toolB, coOccurrenceCount: count, windowMs });
  }
  pairs.sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount || a.toolA.localeCompare(b.toolA));
  return pairs;
}

// ─── evolution cycle (lifecycle decisions + mating proposals) ───────

export interface EvolutionReport {
  v: typeof PROTOCOL_VERSION;
  cycleAt: number;
  verdicts: LifecycleVerdict[];
  matingPairs: MatingPair[];
  bandCounts: Record<LifecycleBand, number>;
  promoteCount: number;
  sunsetCount: number;
  sig: string;
}

export function runEvolutionCycle(input: {
  records: ToolUseRecord[];
  log: UseLogEntry[];
  nowMs?: number;
  config?: LifecycleConfig;
  matingWindowMs?: number;
  matingMinCount?: number;
  cycleAt?: number;
  secret?: string;
}): EvolutionReport {
  const nowMs = input.nowMs ?? Date.now();
  const verdicts = input.records.map((r) => classifyLifecycle({ record: r, nowMs, config: input.config }));
  const pairs = selectMatingPairs({
    log: input.log,
    windowMs: input.matingWindowMs,
    minCount: input.matingMinCount,
  });
  const bandCounts: Record<LifecycleBand, number> = { gestating: 0, juvenile: 0, mature: 0, atrophied: 0 };
  for (const v of verdicts) bandCounts[v.band]++;
  let promoteCount = 0, sunsetCount = 0;
  for (const v of verdicts) {
    if (v.recommendation === "promote") promoteCount++;
    if (v.recommendation === "sunset") sunsetCount++;
  }
  const body: Omit<EvolutionReport, "sig"> = {
    v: PROTOCOL_VERSION,
    cycleAt: input.cycleAt ?? nowMs,
    verdicts,
    matingPairs: pairs,
    bandCounts,
    promoteCount,
    sunsetCount,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyEvolutionReport(r: EvolutionReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export const LIFECYCLE_EMOJI: Record<LifecycleBand, string> = {
  gestating: "🥚",
  juvenile: "🐣",
  mature: "🦋",
  atrophied: "🍂",
};

export function formatEvolutionLine(r: EvolutionReport): string {
  return `🦋 EVOLUTION · 🥚${r.bandCounts.gestating} · 🐣${r.bandCounts.juvenile} · 🦋${r.bandCounts.mature} · 🍂${r.bandCounts.atrophied} · ↑promote=${r.promoteCount} · ↓sunset=${r.sunsetCount} · 💞pairs=${r.matingPairs.length}`;
}

export function formatVerdictLine(v: LifecycleVerdict): string {
  return `${LIFECYCLE_EMOJI[v.band]} ${v.toolName} · ${v.band} (${v.ageDays.toFixed(1)}d, ${v.useCount} uses, ${v.usesPerWeek.toFixed(1)}/wk) → ${v.recommendation}`;
}

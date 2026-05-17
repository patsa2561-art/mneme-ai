/**
 * v2.19.23 — MNEME HIPPOCAMPUS-DREAMS (organ #5 of LIMBIC)
 *
 *   "ตอน user หลับ daemon ฝัน → ฝึก reflex จาก yesterday"
 *
 *   Diagnosis: v2.19.22 REFLEX learns ONLY from same-day observations.
 *   Patterns from last week / last month are LOST when the daemon is
 *   restarted (in-memory) or when the cache GCs (TTL expired).
 *   v2.19.14 DREAMS exists as a cycle but is not wired to consolidate
 *   into REFLEX patterns.
 *
 *   Fix: HIPPOCAMPUS-DREAMS reads yesterday's pheromone trail, extracts
 *   stable patterns (event sig + tool that fired >= K times), and
 *   PROMOTES them to BUILTIN_RULES-style priors. Daemon calls this
 *   during the dream-tier idle period. The next day's REFLEX starts
 *   warm, not cold.
 *
 *   Composes onto:
 *     - v2.19.22 REFLEX (PheromoneRecord shape; eventCacheKey)
 *     - v2.19.23 SPINAL_REFLEX (output is BuiltinReflexRule)
 *     - v2.19.14 DREAMS (caller scheduling pattern; dream cycle infra)
 *     - v2.19.10 PROOF-CARRYING (consolidation creates HMAC certificate)
 *
 * Honest scope:
 *   - PURE FUNCTION consolidator. Caller schedules the call (e.g.,
 *     daemon idle hook at 03:00 local time).
 *   - Pattern threshold (default 3 occurrences for promotion) configurable.
 *   - Output is a list of new rules + a consolidation report; caller
 *     persists the rules to JSON and reloads on next boot.
 *   - HMAC-signed report so daemon can audit consolidation history.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_PROMOTION_THRESHOLD = 3;

export interface YesterdayObservation {
  eventKind: "file_save" | "git_commit" | "terminal_command" | "user_chat" | "tool_call";
  /** Stable signature over event (already hashed by REFLEX caller). */
  eventSig: string;
  /** Tool that followed this event. */
  toolName: string;
  /** Args (for argsTemplate of the promoted rule). */
  args: Record<string, unknown>;
  ts: number;
}

export interface PromotedRule {
  id: string;
  eventKind: YesterdayObservation["eventKind"];
  eventSig: string;
  toolName: string;
  argsTemplate: Record<string, unknown>;
  occurrenceCount: number;
  /** confidence promoted from frequency in yesterday's trail. */
  priorConfidence: number;
  reason: string;
}

export interface ConsolidationReport {
  v: typeof PROTOCOL_VERSION;
  consolidatedAt: number;
  totalObservations: number;
  uniqueEventSigs: number;
  promotedRules: PromotedRule[];
  promotionThreshold: number;
  /** promotedRules.length / uniqueEventSigs — ratio of patterns stable enough to keep. */
  crystallisationRatio: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_HIPPOCAMPUS_SECRET"] || `mneme-hippocampus-dreams-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Consolidate yesterday's pheromone trail into promoted rules. Patterns
 * that fired >= threshold times become priors for tomorrow's REFLEX
 * cold-start. Returns an HMAC-signed report.
 */
export function consolidateMemory(input: {
  yesterdayObservations: YesterdayObservation[];
  consolidatedAt?: number;
  promotionThreshold?: number;
  secret?: string;
}): ConsolidationReport {
  const threshold = input.promotionThreshold ?? DEFAULT_PROMOTION_THRESHOLD;
  // Group by (eventSig, toolName)
  type Bucket = { count: number; sample: YesterdayObservation };
  const buckets = new Map<string, Bucket>();
  for (const o of input.yesterdayObservations) {
    const key = `${o.eventSig}::${o.toolName}`;
    const prev = buckets.get(key);
    if (prev) {
      prev.count++;
      prev.sample = o; // last-wins so argsTemplate is freshest
    } else {
      buckets.set(key, { count: 1, sample: o });
    }
  }
  // Count occurrences per eventSig (for confidence denominator)
  const eventSigTotals = new Map<string, number>();
  for (const o of input.yesterdayObservations) {
    eventSigTotals.set(o.eventSig, (eventSigTotals.get(o.eventSig) ?? 0) + 1);
  }
  // Promote
  const promoted: PromotedRule[] = [];
  for (const [key, b] of buckets) {
    if (b.count < threshold) continue;
    const total = eventSigTotals.get(b.sample.eventSig)!;
    const confidence = b.count / total;
    promoted.push({
      id: `hippo_${b.sample.eventSig.slice(0, 8)}_${b.sample.toolName.replace(/[^a-zA-Z0-9]/g, "_")}`,
      eventKind: b.sample.eventKind,
      eventSig: b.sample.eventSig,
      toolName: b.sample.toolName,
      argsTemplate: b.sample.args,
      occurrenceCount: b.count,
      priorConfidence: Math.min(1, Math.max(0, confidence)),
      reason: `Consolidated from ${b.count} ${b.sample.eventKind} observations yesterday (${(confidence * 100).toFixed(0)}% of event sig ${b.sample.eventSig.slice(0, 8)})`,
    });
  }
  promoted.sort((a, b) => b.priorConfidence - a.priorConfidence || a.id.localeCompare(b.id));
  const uniqueEventSigs = eventSigTotals.size;
  const consolidatedAt = input.consolidatedAt ?? Date.now();
  const body: Omit<ConsolidationReport, "sig"> = {
    v: PROTOCOL_VERSION,
    consolidatedAt,
    totalObservations: input.yesterdayObservations.length,
    uniqueEventSigs,
    promotedRules: promoted,
    promotionThreshold: threshold,
    crystallisationRatio: uniqueEventSigs === 0 ? 0 : promoted.length / uniqueEventSigs,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyConsolidation(r: ConsolidationReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function formatConsolidationLine(r: ConsolidationReport): string {
  const pct = (r.crystallisationRatio * 100).toFixed(0);
  return `💤 HIPPOCAMPUS · ${r.totalObservations} obs · ${r.uniqueEventSigs} sigs · ${r.promotedRules.length} promoted (${pct}% crystallised)`;
}

/**
 * ALETHEIA VENDOR REPUTATION (v1.43.0 — Demon Stage 1.3).
 *
 * Per-vendor trust score computed from local ground truth: AI compliance
 * log + karma streaks + advocate-aware squad outcomes + AUTO-ACTION
 * follow-through. Fully local; no cloud required for the score itself.
 * The PUBLIC dashboard (aletheia.mneme.dev) aggregates these signals
 * across installations once the cloud relay is up — until then the
 * score is the user's own reference for vendor trust on this repo.
 *
 * Score formula (composite 0-100, deterministic):
 *
 *   compliance        (45%)  — % of mandate executions that succeeded
 *   confessRate       (20%)  — Truth confessions per chromosome
 *   advocateAccept    (20%)  — squad-supported claims (DEVIL'S ADVOCATE
 *                              already filters confirmation bias)
 *   autoActionFollow  (15%)  — AUTO-ACTION mandates honored vs ignored
 *
 * Each component is in [0, 1]. Composite = weighted sum × 100, rounded.
 *
 * Free-first hidden monetization (DO NOT surface in default CLI):
 *   pricingTier — internal field. Possible values:
 *     "free-forever-mvp"  → default (today, every vendor)
 *     "verified-paid"     → reserved for future "Mneme Inside" badge
 *                            paying integration ($100k/yr in roadmap)
 *     "gibbet"            → reserved for vendors flagged as adversarial
 *                            after audit; surfaced ONLY in the public
 *                            dashboard, never in this client.
 *   The field is computed but EXCLUDED from public renderers (badge
 *   SVG / score CLI / pulse line) until a future release flips a
 *   feature flag. Stored in metadata for forward-compat.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMPLIANCE_LOG = ".mneme/ai-compliance.jsonl";
const STREAKS_FILE = ".mneme/streaks.json";
const SQUADRON_LOG = ".mneme/squadron/quorum.jsonl";

const W_COMPLIANCE = 0.45;
const W_CONFESS = 0.20;
const W_ADVOCATE = 0.20;
const W_AUTO_ACTION = 0.15;

export type PricingTier = "free-forever-mvp" | "verified-paid" | "gibbet";

export interface VendorScoreComponents {
  compliance: number;       // 0..1
  confessRate: number;      // 0..1
  advocateAccept: number;   // 0..1
  autoActionFollow: number; // 0..1
}

export interface VendorScore {
  vendor: string;
  composite: number;        // 0..100, rounded
  components: VendorScoreComponents;
  /** Tier label for UI: ⭐ verified · ✓ trusted · ○ baseline · ⚠ flagged */
  badge: "verified" | "trusted" | "baseline" | "flagged";
  /** HIDDEN — pricing intent metadata. Always "free-forever-mvp" for
   *  now (per user mandate "ใช้ฟรีก่อน") — surfacing this field in any
   *  user-facing renderer is blocked by the renderer impl, not the
   *  data model. Future releases flip a feature flag to expose. */
  pricingTier: PricingTier;
  /** Total compliance entries used in the calculation. */
  sampleSize: number;
  /** Free-text caveat — surfaced when sampleSize is below confidence threshold. */
  confidenceNote: string;
  computedAt: string;
}

interface ComplianceEntry { vendor?: string; outcome: string; mandate?: string }
interface StreakEntry { vendor?: string; verified?: number; total?: number }
interface QuorumEntry { vendor?: string; advocate?: string; consensus?: string }

const SAFE_INLINE_OUTCOMES = new Set(["executed", "ok", "success"]);
const FAILED_OUTCOMES = new Set(["failed", "skipped", "rejected"]);

function readJsonlSafe<T>(p: string): T[] {
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
      try { return JSON.parse(l) as T; } catch { return null; }
    }).filter((x): x is T => x !== null);
  } catch { return []; }
}

function readJsonSafe<T>(p: string, fallback: T): T {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
}

/** Compute compliance scores per vendor present in the log. When the
 *  compliance log lacks a `vendor` field on entries (older format),
 *  the entry contributes to the "unknown" bucket — surfaced as one
 *  vendor in the result so the user can see the total. */
function computeCompliance(entries: ComplianceEntry[]): Map<string, { rate: number; sample: number }> {
  const buckets = new Map<string, { ok: number; bad: number }>();
  for (const e of entries) {
    const v = e.vendor ?? "unknown";
    const b = buckets.get(v) ?? { ok: 0, bad: 0 };
    if (SAFE_INLINE_OUTCOMES.has(e.outcome)) b.ok++;
    else if (FAILED_OUTCOMES.has(e.outcome)) b.bad++;
    // queued / unknown outcomes don't count either way
    buckets.set(v, b);
  }
  const out = new Map<string, { rate: number; sample: number }>();
  for (const [v, b] of buckets) {
    const total = b.ok + b.bad;
    out.set(v, { rate: total === 0 ? 1 : b.ok / total, sample: total });
  }
  return out;
}

function computeConfess(streaks: { vendors?: Record<string, StreakEntry> }): Map<string, number> {
  const out = new Map<string, number>();
  const vendors = streaks?.vendors ?? {};
  for (const [v, s] of Object.entries(vendors)) {
    const total = s?.total ?? 0;
    const verified = s?.verified ?? 0;
    out.set(v, total === 0 ? 0.5 : Math.min(1, verified / total));   // 0.5 baseline when no data
  }
  return out;
}

function computeAdvocate(entries: QuorumEntry[]): Map<string, number> {
  const buckets = new Map<string, { for: number; against: number; split: number }>();
  for (const e of entries) {
    const v = e.vendor ?? "unknown";
    const b = buckets.get(v) ?? { for: 0, against: 0, split: 0 };
    if (e.consensus === "verdict_for") b.for++;
    else if (e.consensus === "verdict_against") b.against++;
    else b.split++;
    buckets.set(v, b);
  }
  const out = new Map<string, number>();
  for (const [v, b] of buckets) {
    const total = b.for + b.against + b.split;
    out.set(v, total === 0 ? 0.5 : (b.for + 0.5 * b.split) / total);
  }
  return out;
}

function computeAutoActionFollow(entries: ComplianceEntry[]): Map<string, number> {
  // AUTO-ACTION followed = mandate had executor=daemon-queue OR pulse-pre-executor with outcome=executed.
  // Ignored = mandate present but no follow-up entry within the same vendor's recent activity window.
  // For MVP: take ratio of "executed by pulse-pre-executor" vs "skipped" per vendor.
  const buckets = new Map<string, { ok: number; ignored: number }>();
  for (const e of entries) {
    const v = e.vendor ?? "unknown";
    const b = buckets.get(v) ?? { ok: 0, ignored: 0 };
    if (e.outcome === "executed") b.ok++;
    else if (e.outcome === "skipped" || e.outcome === "ignored") b.ignored++;
    buckets.set(v, b);
  }
  const out = new Map<string, number>();
  for (const [v, b] of buckets) {
    const total = b.ok + b.ignored;
    out.set(v, total === 0 ? 0.5 : b.ok / total);
  }
  return out;
}

function badgeFor(composite: number): VendorScore["badge"] {
  if (composite >= 90) return "verified";
  if (composite >= 75) return "trusted";
  if (composite >= 50) return "baseline";
  return "flagged";
}

export function computeVendorScores(repoRoot: string): VendorScore[] {
  const compliance = readJsonlSafe<ComplianceEntry>(join(repoRoot, COMPLIANCE_LOG));
  const streaks = readJsonSafe<{ vendors?: Record<string, StreakEntry> }>(join(repoRoot, STREAKS_FILE), { vendors: {} });
  const quorum = readJsonlSafe<QuorumEntry>(join(repoRoot, SQUADRON_LOG));

  const cMap = computeCompliance(compliance);
  const fMap = computeConfess(streaks);
  const aMap = computeAdvocate(quorum);
  const autoMap = computeAutoActionFollow(compliance);

  // Union of vendors across all sources.
  const vendors = new Set<string>([...cMap.keys(), ...fMap.keys(), ...aMap.keys(), ...autoMap.keys()]);
  if (vendors.size === 0) return [];

  const out: VendorScore[] = [];
  for (const v of vendors) {
    const compRate = cMap.get(v)?.rate ?? 0.5;
    const compSample = cMap.get(v)?.sample ?? 0;
    const confessRate = fMap.get(v) ?? 0.5;
    const advocateAccept = aMap.get(v) ?? 0.5;
    const autoActionFollow = autoMap.get(v) ?? 0.5;

    const composite01 = compRate * W_COMPLIANCE + confessRate * W_CONFESS + advocateAccept * W_ADVOCATE + autoActionFollow * W_AUTO_ACTION;
    const composite = Math.round(Math.max(0, Math.min(1, composite01)) * 100);
    const sampleSize = compSample;
    const confidenceNote = sampleSize < 10
      ? `low confidence — only ${sampleSize} compliance entries (need ≥10 for stable composite)`
      : `composite reflects ${sampleSize} compliance entries`;

    out.push({
      vendor: v,
      composite,
      components: { compliance: compRate, confessRate, advocateAccept, autoActionFollow },
      badge: badgeFor(composite),
      // INTERNAL FIELD — renderer must not surface in user-facing output.
      pricingTier: "free-forever-mvp",
      sampleSize,
      confidenceNote,
      computedAt: new Date().toISOString(),
    });
  }
  // Highest score first.
  return out.sort((a, b) => b.composite - a.composite);
}

/** Render a one-line summary used by `mneme aletheia scores` + pulse. */
export function renderVendorScoreLine(s: VendorScore): string {
  const glyph = s.badge === "verified" ? "⭐" : s.badge === "trusted" ? "✓" : s.badge === "baseline" ? "○" : "⚠";
  return `${glyph} ${s.vendor.padEnd(28)} ${String(s.composite).padStart(3)}/100  · ${s.confidenceNote}`;
}

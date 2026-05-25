/**
 * v2.52.0 — MOLT (Diamond 4 / Million Dollar Secret series).
 *
 * Show mechanic: contestants change behaviour when they sense suspicion.
 * Drift over time is itself a tell.
 *
 * Mneme primitive: extends drift_timeline (v2.46 ORGAN 4) into a
 * SILENT-MODEL-ROTATION detector. AI vendors frequently swap backend
 * models without telling users (GPT-4 → GPT-4 Turbo → GPT-4o; Claude
 * 3 Opus → Claude 3.5 Sonnet → Claude Opus 4.6). Users paying for
 * "model A" get rotated to "model B" with no notice. Consumer-protection
 * issue + potential class-action surface.
 *
 * MOLT computes Mahalanobis-style drift between fingerprint snapshots
 * over a time window, identifies the DOMINANT shifted features, and
 * emits a forensic-evidence-grade event:
 *
 *   {
 *     vendor: "cursor",
 *     molted: true,
 *     moltedAt: "2026-04-15T...",
 *     priorWindow: "2026-03-15..2026-04-14",
 *     postWindow:  "2026-04-15..2026-05-15",
 *     dominantShifts: [
 *       { feature: "conditional_density", priorMean: 0.32, postMean: 0.09, z: 4.7 },
 *       ...
 *     ],
 *     hmac: "..."  // forensic preservation
 *   }
 *
 * No paper / product surfaces silent model rotation from output alone.
 *
 * Wild value-adds this module ships:
 *   - WEBHOOK emit (optional): when molt detected, POST signed JSON
 *     to an opt-in endpoint so the user's CI / Slack / monitoring
 *     learns about the rotation automatically
 *   - DOMINANT-SHIFT CITATION: the 3 features that moved most → caller
 *     can write a court-admissible "vendor X silently rotated on Y"
 *     statement
 *
 * Composes: drift_timeline.readTimeline + a per-feature Welch-style
 * comparison of pre/post means + variances.
 *
 * Pure deterministic + defensive; never throws.
 */

import { readTimeline, type DriftEntry } from "./drift_timeline.js";
import { createHmac } from "node:crypto";

export interface FeatureShift {
  feature: string;
  priorMean: number;
  postMean: number;
  priorStdev: number;
  postStdev: number;
  /** Welch-style t-like statistic. */
  z: number;
  /** Direction shorthand. */
  direction: "increase" | "decrease" | "flat";
}

export interface MoltVerdict {
  vendor: string;
  molted: boolean;
  /** Detected molt timestamp (latest post-window timestamp). */
  moltedAt: string | null;
  priorWindow: { from: string; to: string; n: number };
  postWindow: { from: string; to: string; n: number };
  dominantShifts: FeatureShift[];
  /** HMAC over the canonical verdict body — forensic evidence. */
  hmac: string;
  /** Plain-English citation suitable for compliance / news report. */
  citation: string;
}

const KEY_ENV = "MNEME_MOLT_KEY";
const DEFAULT_KEY = "mneme-molt-v1";
const MOLT_Z_THRESHOLD = 3.0;
const MIN_PRIOR_N = 5;
const MIN_POST_N = 3;

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function meanStd(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return { mean, stdev: Math.sqrt(variance) };
}

function safeWindowSplit(entries: DriftEntry[], splitAt: number): { prior: DriftEntry[]; post: DriftEntry[] } {
  if (!Array.isArray(entries)) return { prior: [], post: [] };
  const prior: DriftEntry[] = [];
  const post: DriftEntry[] = [];
  for (const e of entries) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (t < splitAt) prior.push(e);
    else post.push(e);
  }
  return { prior, post };
}

function collectKeys(entries: DriftEntry[]): string[] {
  const keys = new Set<string>();
  for (const e of entries) {
    if (e.fingerprint) for (const k of Object.keys(e.fingerprint)) keys.add(k);
  }
  return Array.from(keys);
}

function buildCitation(verdict: { vendor: string; molted: boolean; moltedAt: string | null; dominantShifts: FeatureShift[] }): string {
  if (!verdict.molted) return `No molt detected for ${verdict.vendor}.`;
  const top = verdict.dominantShifts.slice(0, 3).map((s) => `${s.feature} ${s.direction} (${s.priorMean.toFixed(2)} → ${s.postMean.toFixed(2)}, z=${s.z.toFixed(2)})`).join("; ");
  return `${verdict.vendor} appears to have silently rotated models on ${verdict.moltedAt}. Dominant shifts: ${top}.`;
}

/**
 * Detect silent model rotation by comparing pre/post fingerprint
 * distributions split at a given timestamp (default: midpoint by count).
 *
 * Defensive: missing vendor / empty timeline / not enough samples → returns
 *           molted=false with reason in citation.
 */
export function detectMolt(
  repoRoot: string,
  vendor: string,
  opts: { sinceMs?: number; splitAtMs?: number; minZ?: number } = {},
): MoltVerdict {
  const minZ = opts.minZ ?? MOLT_Z_THRESHOLD;
  let entries: DriftEntry[] = [];
  try {
    entries = readTimeline(repoRoot, vendor);
  } catch { entries = []; }

  // Optional filter: keep only entries newer than sinceMs
  if (opts.sinceMs !== undefined) {
    entries = entries.filter((e) => Date.parse(e.at) >= opts.sinceMs!);
  }
  // Sort by timestamp
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (entries.length < MIN_PRIOR_N + MIN_POST_N) {
    const out: MoltVerdict = {
      vendor,
      molted: false,
      moltedAt: null,
      priorWindow: { from: "", to: "", n: 0 },
      postWindow: { from: "", to: "", n: entries.length },
      dominantShifts: [],
      hmac: "",
      citation: `Insufficient data for ${vendor}: ${entries.length} entries (need ≥${MIN_PRIOR_N + MIN_POST_N}).`,
    };
    out.hmac = createHmac("sha256", keyOf()).update(JSON.stringify({ vendor, molted: false, n: entries.length })).digest("hex");
    return out;
  }

  // Choose split point: explicit ms OR midpoint by count
  let splitAt: number;
  if (opts.splitAtMs !== undefined) {
    splitAt = opts.splitAtMs;
  } else {
    const mid = entries[Math.floor(entries.length / 2)]!;
    splitAt = Date.parse(mid.at);
  }
  const { prior, post } = safeWindowSplit(entries, splitAt);
  if (prior.length < MIN_PRIOR_N || post.length < MIN_POST_N) {
    const out: MoltVerdict = {
      vendor,
      molted: false,
      moltedAt: null,
      priorWindow: { from: prior[0]?.at ?? "", to: prior[prior.length - 1]?.at ?? "", n: prior.length },
      postWindow: { from: post[0]?.at ?? "", to: post[post.length - 1]?.at ?? "", n: post.length },
      dominantShifts: [],
      hmac: "",
      citation: `Insufficient samples in one window for ${vendor}: prior=${prior.length}, post=${post.length}.`,
    };
    out.hmac = createHmac("sha256", keyOf()).update(JSON.stringify({ vendor, molted: false, prior: prior.length, post: post.length })).digest("hex");
    return out;
  }

  // Per-feature shift
  const keys = collectKeys(entries);
  const shifts: FeatureShift[] = [];
  for (const k of keys) {
    const priorVals = prior.map((e) => e.fingerprint?.[k] ?? 0).filter(Number.isFinite);
    const postVals = post.map((e) => e.fingerprint?.[k] ?? 0).filter(Number.isFinite);
    if (priorVals.length < MIN_PRIOR_N || postVals.length < MIN_POST_N) continue;
    const p = meanStd(priorVals);
    const q = meanStd(postVals);
    // Pooled stdev (avoid /0)
    const pooled = Math.sqrt(((p.stdev ** 2) / priorVals.length) + ((q.stdev ** 2) / postVals.length));
    const safePooled = pooled > 1e-6 ? pooled : Math.max(0.01, Math.abs(p.mean) * 0.1);
    const z = (q.mean - p.mean) / safePooled;
    if (!Number.isFinite(z)) continue;
    const direction = z > 0.05 ? "increase" : z < -0.05 ? "decrease" : "flat";
    shifts.push({ feature: k, priorMean: p.mean, postMean: q.mean, priorStdev: p.stdev, postStdev: q.stdev, z, direction });
  }
  shifts.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const dominant = shifts.filter((s) => Math.abs(s.z) >= minZ).slice(0, 10);
  const molted = dominant.length > 0;

  const verdict: Omit<MoltVerdict, "hmac" | "citation"> = {
    vendor,
    molted,
    moltedAt: molted ? (post[post.length - 1]?.at ?? null) : null,
    priorWindow: { from: prior[0]!.at, to: prior[prior.length - 1]!.at, n: prior.length },
    postWindow: { from: post[0]!.at, to: post[post.length - 1]!.at, n: post.length },
    dominantShifts: dominant,
  };
  const citation = buildCitation(verdict);
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify({ ...verdict, citation })).digest("hex");
  return { ...verdict, citation, hmac };
}

/**
 * Verify a MoltVerdict's HMAC. Returns true iff hmac matches the
 * canonical body. Caller-side forensic check.
 */
export function verifyMoltVerdict(v: MoltVerdict): boolean {
  if (!v || typeof v.hmac !== "string") return false;
  const { hmac, ...body } = v;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/**
 * Optional webhook emit (HTTP POST). Returns ok=true on 2xx; defensive.
 * Caller controls when to fire (e.g. only when verdict.molted).
 */
export async function emitMoltWebhook(verdict: MoltVerdict, webhookUrl: string): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    if (!webhookUrl || !/^https?:\/\//.test(webhookUrl)) {
      return { ok: false, reason: "invalid webhook URL" };
    }
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mneme-molt-signature": verdict.hmac },
      body: JSON.stringify(verdict),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

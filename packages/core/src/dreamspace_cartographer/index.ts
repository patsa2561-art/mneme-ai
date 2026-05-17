/**
 * v2.19.27 — MNEME DREAMSPACE · CARTOGRAPHER (stage 2 of 6)
 *
 *   "build map: tool X handles input pattern Y with quality Z, store
 *    ใน PROPRIOCEPTION → REFLEX query proprioception ตอน predict-
 *    next-tool → 90/100 stuck features เริ่มถูก trigger ตามที่จริง"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: PROBE measures per-tool fitness; CARTOGRAPHER aggregates
 *   ACROSS many probe reports into a queryable capability map. REFLEX
 *   then asks "which tool best handles this input pattern?" and gets
 *   evidence-backed answer instead of frequency guess.
 *
 *   The map is a 2D index:
 *     pattern_signature → tool_name → quality_score
 *   Pattern signature is a content-addressed hash of the input shape
 *   (kind + sorted key list). Stable across probe runs; case-insensitive.
 *
 *   Composes onto:
 *     - v2.19.27 PROBE (consumes ToolProbeReport.runs)
 *     - v2.19.23 PROPRIOCEPTION (unified catalog; caller stores map here)
 *     - v2.19.22 REFLEX (queries map at predict-next-tool time)
 *     - v2.19.26 GESTATION (gaps in map = signal for proposeToolSpec)
 *
 * Honest scope:
 *   - PURE FUNCTION builder. Caller persists the CapabilityMap to disk.
 *   - Pattern signature is conservative (kind + sorted key names); we
 *     don't try to infer semantic intent — that's PROPRIOCEPTION's job.
 *   - HMAC-signed map so federation can ship verified capability maps.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_BLEND_WEIGHT = 0.3;

export interface CapabilityCell {
  toolName: string;
  patternSig: string;
  patternLabel: string;
  /** Aggregate quality 0..1 over all probes for this (tool, pattern). */
  quality: number;
  /** How many probes contributed to this quality estimate. */
  sampleCount: number;
  /** Last probe time. */
  lastProbedAt: number;
}

export interface CapabilityMap {
  v: typeof PROTOCOL_VERSION;
  cells: CapabilityCell[];
  totalProbes: number;
  uniquePatterns: number;
  uniqueTools: number;
  builtAt: number;
  sig: string;
}

export interface ProbeRunForMap {
  toolName: string;
  inputLabel: string;
  inputArgs: Record<string, unknown>;
  ok: boolean;
  /** Per-run quality 0..1 (caller usually feeds ProbeReport.metrics.fitnessScore). */
  qualityForThisRun: number;
  probedAt: number;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_CARTOGRAPHER_SECRET"] || `mneme-dreamspace-cartographer-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Pattern signature from input args: kind discriminator + sorted key list.
 *   { name: "x", count: 3 } → "obj:count,name"
 *   [] → "arr:empty"
 *   "hello" → "str:len5"
 *   42 → "num"
 *   null → "null"
 * Stable; case-insensitive; never reveals user data.
 */
export function patternSignature(args: unknown): string {
  if (args === null) return "null";
  if (args === undefined) return "undef";
  if (Array.isArray(args)) return args.length === 0 ? "arr:empty" : `arr:len${args.length < 5 ? "small" : args.length < 50 ? "med" : "large"}`;
  if (typeof args === "object") {
    const keys = Object.keys(args).map((k) => k.toLowerCase()).sort();
    return keys.length === 0 ? "obj:empty" : `obj:${keys.join(",")}`;
  }
  if (typeof args === "string") return `str:len${args.length === 0 ? "0" : args.length < 32 ? "small" : "large"}`;
  return typeof args;
}

/**
 * Build a fresh CapabilityMap from a list of probe runs.
 *
 * Aggregation: for each (toolName, patternSig) cell, quality is the
 * weighted mean of qualityForThisRun across all probes for that cell.
 * Recent probes weight slightly more than old probes (recency bias
 * controlled by `blendWeight` per new probe).
 */
export function buildCapabilityMap(input: {
  probes: ProbeRunForMap[];
  builtAt?: number;
  blendWeight?: number;
  secret?: string;
}): CapabilityMap {
  const w = input.blendWeight ?? DEFAULT_BLEND_WEIGHT;
  type Acc = { quality: number; sampleCount: number; lastProbedAt: number; patternLabel: string };
  const byCell = new Map<string, Acc>();
  // Sort probes chronologically for stable EWMA evolution
  const sorted = [...input.probes].sort((a, b) => a.probedAt - b.probedAt);
  for (const p of sorted) {
    const sig = patternSignature(p.inputArgs);
    const key = `${p.toolName}::${sig}`;
    const prev = byCell.get(key);
    if (prev) {
      // Exponential moving average; defaults to 0.3 new weight (slow drift).
      prev.quality = (1 - w) * prev.quality + w * p.qualityForThisRun;
      prev.sampleCount++;
      prev.lastProbedAt = Math.max(prev.lastProbedAt, p.probedAt);
    } else {
      byCell.set(key, {
        quality: p.qualityForThisRun,
        sampleCount: 1,
        lastProbedAt: p.probedAt,
        patternLabel: p.inputLabel,
      });
    }
  }
  const cells: CapabilityCell[] = [];
  for (const [key, acc] of byCell) {
    const [toolName, patternSig] = key.split("::") as [string, string];
    cells.push({
      toolName,
      patternSig,
      patternLabel: acc.patternLabel,
      quality: acc.quality,
      sampleCount: acc.sampleCount,
      lastProbedAt: acc.lastProbedAt,
    });
  }
  // Stable order: by patternSig asc, then quality desc, then toolName asc
  cells.sort((a, b) =>
    a.patternSig.localeCompare(b.patternSig) ||
    b.quality - a.quality ||
    a.toolName.localeCompare(b.toolName),
  );
  const uniquePatterns = new Set(cells.map((c) => c.patternSig)).size;
  const uniqueTools = new Set(cells.map((c) => c.toolName)).size;
  const body: Omit<CapabilityMap, "sig"> = {
    v: PROTOCOL_VERSION,
    cells,
    totalProbes: input.probes.length,
    uniquePatterns,
    uniqueTools,
    builtAt: input.builtAt ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyCapabilityMap(m: CapabilityMap, secret?: string): boolean {
  const { sig, ...body } = m;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/**
 * Query the map for tools that handle a given input shape. Returns the
 * top-N by quality desc. REFLEX's predict-next-tool path calls this
 * BEFORE falling back to frequency-only prediction.
 */
export function queryCapability(input: {
  map: CapabilityMap;
  args: unknown;
  topN?: number;
  minQuality?: number;
}): CapabilityCell[] {
  const sig = patternSignature(input.args);
  const minQ = input.minQuality ?? 0;
  const topN = input.topN ?? 5;
  return input.map.cells
    .filter((c) => c.patternSig === sig && c.quality >= minQ)
    .slice(0, topN);
}

export interface CartographerStats {
  totalCells: number;
  uniquePatterns: number;
  uniqueTools: number;
  meanQuality: number;
  /** Cells with quality >= 0.7 — "well-mapped" entries. */
  highQualityCells: number;
  /** Cells with sampleCount = 1 — single-probe estimates, low confidence. */
  singleProbeCells: number;
}

export function computeMapStats(m: CapabilityMap): CartographerStats {
  const total = m.cells.length;
  const meanQuality = total === 0 ? 0 : m.cells.reduce((s, c) => s + c.quality, 0) / total;
  const highQ = m.cells.filter((c) => c.quality >= 0.7).length;
  const single = m.cells.filter((c) => c.sampleCount === 1).length;
  return {
    totalCells: total,
    uniquePatterns: m.uniquePatterns,
    uniqueTools: m.uniqueTools,
    meanQuality,
    highQualityCells: highQ,
    singleProbeCells: single,
  };
}

export function formatMapLine(s: CartographerStats): string {
  return `🗺 CARTOGRAPHER · ${s.totalCells} cells · ${s.uniqueTools} tools × ${s.uniquePatterns} patterns · ${s.highQualityCells} high-Q · meanQ=${s.meanQuality.toFixed(2)}`;
}

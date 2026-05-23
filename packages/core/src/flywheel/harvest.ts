/**
 * v2.32.0 — FLYWHEEL HARVEST stage.
 *
 * Pulls raw findings from every source primitive's existing ledger.
 * Pure file reads + JSONL parsing — NO new state, NO new primitive
 * call. Every reader is best-effort: a missing file = empty list
 * (FLYWHEEL still emits a useful report on a fresh install).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { RawFinding, SignalSource } from "./types.js";

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(isoA); const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function safeJsonl<T>(p: string, limit: number): T[] {
  if (!existsSync(p)) return [];
  try {
    const body = readFileSync(p, "utf8");
    const lines = body.split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    const out: T[] = [];
    for (const ln of slice) { try { out.push(JSON.parse(ln) as T); } catch { /* skip */ } }
    return out;
  } catch { return []; }
}

// ── TRUTH GATE harvest ──────────────────────────────────────────────

interface TruthGateMatrixLine {
  seq?: number;
  finishedAt?: string;
  summary?: { pass?: number; drift?: number; refuted?: number };
  drifted?: Array<{ claimId?: string; headline?: string }>;
}

export function harvestTruthGate(repoRoot: string, limit: number): RawFinding[] {
  const p = join(repoRoot, ".mneme", "truth_gate", "matrix.jsonl");
  const rows = safeJsonl<TruthGateMatrixLine>(p, limit);
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const r of rows) {
    const at = r.finishedAt ?? now;
    for (const d of r.drifted ?? []) {
      if (!d.claimId) continue;
      out.push({
        source: "truth_gate",
        id: `${d.claimId}`,
        headline: d.headline ?? `TRUTH GATE drift on ${d.claimId}`,
        severity: "warn",
        firstSeen: at, lastSeen: at,
        ageDays: daysBetween(at, now),
        detail: { claimId: d.claimId },
      });
    }
  }
  return out;
}

// ── PEAK GAUNTLET harvest ───────────────────────────────────────────

interface GauntletScoreLine {
  seq?: number;
  finishedAt?: string;
  overall?: number;
  findings?: Array<{ id?: string; title?: string; stars?: number }>;
}

export function harvestGauntlet(repoRoot: string, limit: number): RawFinding[] {
  const p = join(repoRoot, ".mneme", "tune", "scorecard.jsonl");
  const rows = safeJsonl<GauntletScoreLine>(p, limit);
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  const last = rows[rows.length - 1];
  if (!last) return out;
  const at = last.finishedAt ?? now;
  for (const f of last.findings ?? []) {
    if (!f.id || typeof f.stars !== "number") continue;
    if (f.stars >= 10) continue;
    out.push({
      source: "peak_gauntlet",
      id: f.id,
      headline: f.title ? `${f.id} ${f.stars}★: ${f.title}` : `${f.id} ${f.stars}★`,
      severity: f.stars <= 5 ? "block" : "warn",
      firstSeen: at, lastSeen: at,
      ageDays: daysBetween(at, now),
      detail: { stars: f.stars, title: f.title },
    });
  }
  return out;
}

// ── HONEST MIRROR harvest ───────────────────────────────────────────

interface MirrorLedgerLine {
  seq?: number;
  finishedAt?: string;
  trafficLight?: string;
  headline?: string;
  perVendor?: Array<{ vendor?: string; delta?: number; weight?: number }>;
}

export function harvestHonestMirror(repoRoot: string, limit: number): RawFinding[] {
  const p = join(repoRoot, ".mneme", "honest_mirror", "reports.jsonl");
  const rows = safeJsonl<MirrorLedgerLine>(p, limit);
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const r of rows) {
    if (r.trafficLight === "green") continue;
    const at = r.finishedAt ?? now;
    for (const v of r.perVendor ?? []) {
      if (!v.vendor || typeof v.delta !== "number") continue;
      // Skip mock vendors — their deterministic answers can't match real
      // commit diffs, so they're not an honest calibration signal (same
      // filter TRUTH GATE applies in probes.ts).
      if (v.vendor.startsWith("mock") || v.vendor.includes("@mock")) continue;
      const abs = Math.abs(v.delta);
      if (abs < 0.1) continue;
      out.push({
        source: "honest_mirror",
        id: `vendor:${v.vendor}`,
        headline: `${v.vendor} calibration Δ=${(v.delta * 100).toFixed(0)}%`,
        severity: abs >= 0.25 ? "block" : "warn",
        firstSeen: at, lastSeen: at,
        ageDays: daysBetween(at, now),
        detail: { vendor: v.vendor, delta: v.delta, weight: v.weight },
      });
    }
  }
  return out;
}

// ── REWIND harvest ──────────────────────────────────────────────────

interface RewindCardLine {
  seq?: number;
  runAt?: string;
  vendor?: string;
  vendorVersion?: string;
  regression?: string;
  delta?: number;
  weight?: number;
  headline?: string;
}

export function harvestRewind(repoRoot: string, limit: number): RawFinding[] {
  const p = join(repoRoot, ".mneme", "rewind", "cards.jsonl");
  const rows = safeJsonl<RewindCardLine>(p, limit);
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const r of rows) {
    if (r.regression !== "regression") continue;
    const at = r.runAt ?? now;
    out.push({
      source: "rewind",
      id: `vendor:${r.vendor ?? "?"}@${r.vendorVersion ?? "?"}`,
      headline: r.headline ?? `REWIND regression for ${r.vendor}@${r.vendorVersion}`,
      severity: Math.abs(r.delta ?? 0) >= 0.15 ? "block" : "warn",
      firstSeen: at, lastSeen: at,
      ageDays: daysBetween(at, now),
      detail: { vendor: r.vendor, vendorVersion: r.vendorVersion, delta: r.delta, weight: r.weight },
    });
  }
  return out;
}

// ── HGP harvest ─────────────────────────────────────────────────────

interface HgpLine {
  hgpId?: string;
  simhash?: string;
  firstSeen?: string;
  lastSeen?: string;
  observeCount?: number;
  vendorCounts?: Record<string, number>;
  severity?: number;
  sample?: string;
}

export function harvestHgp(repoRoot: string, limit: number): RawFinding[] {
  const p = join(repoRoot, ".mneme", "hgp", "registry.jsonl");
  const rows = safeJsonl<HgpLine>(p, limit);
  // Collapse by id, pick top-N by severity (recompute on collapsed view).
  const byId = new Map<string, HgpLine>();
  for (const r of rows) {
    if (!r.hgpId) continue;
    const cur = byId.get(r.hgpId);
    if (!cur) { byId.set(r.hgpId, { ...r }); continue; }
    cur.lastSeen = (r.lastSeen ?? cur.lastSeen);
    cur.observeCount = (cur.observeCount ?? 0) + (r.observeCount ?? 0);
    cur.vendorCounts = { ...cur.vendorCounts };
    for (const [v, c] of Object.entries(r.vendorCounts ?? {})) {
      cur.vendorCounts![v] = (cur.vendorCounts![v] ?? 0) + c;
    }
  }
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const r of byId.values()) {
    const sev = (r.severity ?? 0);
    if (sev < 0.3) continue;
    out.push({
      source: "hgp",
      id: r.hgpId!,
      headline: `${r.hgpId} severity ${sev.toFixed(2)} · ${r.observeCount ?? 0} obs · ${Object.keys(r.vendorCounts ?? {}).length} vendor(s)`,
      severity: sev >= 0.7 ? "block" : "warn",
      firstSeen: r.firstSeen ?? now,
      lastSeen: r.lastSeen ?? now,
      ageDays: daysBetween(r.lastSeen ?? now, now),
      detail: { hgpId: r.hgpId, simhash: r.simhash, observeCount: r.observeCount, vendorCounts: r.vendorCounts, sample: r.sample },
    });
  }
  return out;
}

// ── Command history harvest ─────────────────────────────────────────
// Best-effort: any caller of flywheel.cheatsheet pushes its own
// invocation into .mneme/flywheel/cmd_history.jsonl so the personal
// cheatsheet bootstraps itself.

interface CmdHistoryLine { command: string; at: string; }

export function harvestCommandHistory(repoRoot: string, limit: number): CmdHistoryLine[] {
  const p = join(repoRoot, ".mneme", "flywheel", "cmd_history.jsonl");
  return safeJsonl<CmdHistoryLine>(p, limit);
}

// ── Marketing diff harvest ──────────────────────────────────────────
// Scans README + docs/*.md for numeric / categorical assertions that
// LOOK like measurable claims but have no probe binding in TRUTH GATE.
// Recommends ADDING a probe (heal action).

const NUMERIC_CLAIM_RX = /\b(\d{1,5})\s*(\/\s*\d{1,5})?\s*(primitives|tools|tests|cards|claims|HGP-IDs|findings|vendors|attack vectors|stars|points)\b/gi;
const SUPERLATIVE_RX = /\b(world-first|world's first|the only|first ever|never before|no AI tool)\b/gi;

export interface MarketingClaim {
  file: string;
  text: string;
  kind: "numeric" | "superlative";
}

export function harvestMarketing(repoRoot: string, knownBoundClaimIds: string[]): RawFinding[] {
  const candidates: MarketingClaim[] = [];
  for (const file of ["README.md", "docs/FUNCTIONS-EN.md", "docs/FUNCTIONS-TH.md"]) {
    const p = join(repoRoot, file);
    if (!existsSync(p)) continue;
    try {
      const body = readFileSync(p, "utf8");
      for (const m of body.matchAll(NUMERIC_CLAIM_RX)) {
        candidates.push({ file, text: m[0]!, kind: "numeric" });
      }
      for (const m of body.matchAll(SUPERLATIVE_RX)) {
        candidates.push({ file, text: m[0]!, kind: "superlative" });
      }
    } catch { /* skip */ }
  }
  // Dedup by (file, text).
  const seen = new Set<string>();
  const unique: MarketingClaim[] = [];
  for (const c of candidates) {
    const k = `${c.file}|${c.text.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); unique.push(c);
  }
  // For v2.32.0 we report all UNIQUE claim candidates as candidates
  // for binding — TRUTH GATE catalog growth is tracked separately.
  // A future version will simhash-match candidates to known bound
  // claim ids; for now we surface them all as info-level findings.
  void knownBoundClaimIds;
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const c of unique) {
    out.push({
      source: "marketing_diff",
      id: `${c.file}::${c.text.slice(0, 40).toLowerCase().replace(/\s+/g, "_")}`,
      headline: `${c.kind} claim in ${c.file}: "${c.text}"`,
      severity: "info",
      firstSeen: now, lastSeen: now,
      ageDays: 0,
      detail: { file: c.file, text: c.text, kind: c.kind },
    });
  }
  return out;
}

// ── Primitive registry harvest (liveness) ───────────────────────────
// Reads .mneme/flywheel/primitive_ledger.jsonl — every primitive that
// fires its MCP/CLI surface should push a heartbeat row. Primitives
// shipped > minDeleteAge days WITHOUT a heartbeat row are dormant.

interface PrimitiveHeartbeat { name: string; at: string; shippedAt?: string; }

export function harvestLiveness(
  repoRoot: string,
  registrySnapshot: Array<{ name: string; sinceVersion?: string }>,
  minDeleteAge: number,
): RawFinding[] {
  const p = join(repoRoot, ".mneme", "flywheel", "primitive_ledger.jsonl");
  const beats = safeJsonl<PrimitiveHeartbeat>(p, 10000);
  // FIRST-RUN GRACE: if the ledger has fewer than 5 heartbeats, we
  // haven't seen enough live traffic to call anything "dormant" yet.
  // Skip the dormant check until the system has been used a bit.
  // Without this guard, the FIRST flywheel.run on a fresh install
  // would flag every shipped primitive as dormant (correct logic but
  // useless signal — nothing has had a chance to fire).
  if (beats.length < 5) return [];
  const lastSeenByName = new Map<string, string>();
  const shippedByName = new Map<string, string>();
  for (const b of beats) {
    if (!b.name) continue;
    const cur = lastSeenByName.get(b.name);
    if (!cur || b.at > cur) lastSeenByName.set(b.name, b.at);
    if (b.shippedAt && !shippedByName.has(b.name)) shippedByName.set(b.name, b.shippedAt);
  }
  const now = new Date().toISOString();
  const out: RawFinding[] = [];
  for (const prim of registrySnapshot) {
    const last = lastSeenByName.get(prim.name);
    // Only treat as dormant if we have a known shipped date. Without
    // shippedAt, we can't honestly say it's "old" — could be a brand
    // new primitive that just hasn't beat yet.
    const shipped = shippedByName.get(prim.name);
    if (last) continue; // alive
    if (!shipped) continue; // unknown age — don't flag
    const ageDays = daysBetween(shipped, now);
    if (ageDays < minDeleteAge) continue;
    out.push({
      source: "primitive_registry",
      id: prim.name,
      headline: `Dormant primitive: ${prim.name} (shipped ${ageDays}d ago, never invoked)`,
      severity: ageDays >= 90 ? "block" : "warn",
      firstSeen: shipped, lastSeen: shipped,
      ageDays,
      detail: { name: prim.name, sinceVersion: prim.sinceVersion ?? "?" },
    });
  }
  return out;
}

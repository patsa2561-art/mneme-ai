/**
 * v2.32.0 — FLYWHEEL controller (5-stage pipeline).
 *
 *   HARVEST → FUSE → PRESCRIBE → EXECUTE → RECIPROCITY
 *
 * HARVEST pulls raw findings from 5 source primitives + cmd history.
 * FUSE cross-pollinates by cluster key (vendor / claim / simhash).
 * PRESCRIBE turns clusters into Heal/Wire/Delete/Shrink/Publish actions.
 * EXECUTE emits HMAC-signed FlywheelReport + writes side-effects when
 *   dryRun=false (currently: applies reciprocity trust deltas).
 * RECIPROCITY records vendor responses (separate API surface so users
 *   can post a bulletin and record the vendor reaction days later).
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import type {
  FlywheelOptions, FlywheelReport, PrescribedAction, RawFinding, SignalSource,
} from "./types.js";
import { fuse, distinctClusterCount } from "./fuse.js";
import { prescribe } from "./prescribe.js";
import {
  harvestTruthGate, harvestGauntlet, harvestHonestMirror, harvestRewind,
  harvestHgp, harvestMarketing, harvestLiveness,
} from "./harvest.js";
import type { PrimitiveSnapshot } from "./liveness.js";
import { applyToAletheiaWeights } from "./reciprocity.js";
import { readLedger as readReciprocityLedger } from "./reciprocity.js";

const HMAC_KEY = process.env["MNEME_FLYWHEEL_KEY"] ?? "mneme-flywheel-v1";
const CHAIN_SEED = "0".repeat(64);

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function hmacOf(prev: string, payload: string): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + payload).digest("hex");
}

let lastChainLink = CHAIN_SEED;
export function __resetFlywheelChainForTest(): void { lastChainLink = CHAIN_SEED; }

export interface RunInput {
  repoRoot: string;
  /** Snapshot of currently-registered primitives (caller supplies — avoids cycle). */
  primitives: PrimitiveSnapshot[];
  /** Currently-bound TRUTH GATE claim ids (caller supplies). */
  knownClaimIds: string[];
  options?: FlywheelOptions;
}

export async function runFlywheel(input: RunInput): Promise<FlywheelReport> {
  const { repoRoot, primitives, knownClaimIds } = input;
  const opts = input.options ?? {};
  const perSourceLimit = opts.perSourceLimit ?? 500;
  const minDeleteAge = opts.minDeleteAge ?? 0;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // ── HARVEST ────────────────────────────────────────────────────────
  const harvest: Record<SignalSource, RawFinding[]> = {
    truth_gate: harvestTruthGate(repoRoot, perSourceLimit),
    peak_gauntlet: harvestGauntlet(repoRoot, perSourceLimit),
    honest_mirror: harvestHonestMirror(repoRoot, perSourceLimit),
    rewind: harvestRewind(repoRoot, perSourceLimit),
    hgp: harvestHgp(repoRoot, perSourceLimit),
    marketing_diff: harvestMarketing(repoRoot, knownClaimIds),
    primitive_registry: harvestLiveness(repoRoot, primitives, minDeleteAge),
    command_history: [], // surfaced via the personal_cheatsheet API, not as findings
  };
  const allRaw = Object.values(harvest).flat();
  const harvestCounts = Object.fromEntries(
    Object.entries(harvest).map(([k, v]) => [k, v.length])
  ) as Record<SignalSource, number>;

  // ── FUSE ───────────────────────────────────────────────────────────
  const fused = fuse(allRaw);
  const clusterCount = distinctClusterCount(fused);

  // ── PRESCRIBE ──────────────────────────────────────────────────────
  const actions = prescribe(fused);

  // ── EXECUTE side-effects (idempotent + opt-out via dryRun) ─────────
  let appliedReciprocity: Record<string, number> = {};
  if (!opts.dryRun) {
    try { appliedReciprocity = applyToAletheiaWeights(repoRoot); } catch { /* best-effort */ }
  }
  void appliedReciprocity;

  const reciprocity = readReciprocityLedger(repoRoot, 30);

  // ── Health metric ──────────────────────────────────────────────────
  const blockCount = actions.filter((a) => a.blocking).length;
  const total = Math.max(1, actions.length);
  const health = Math.round(((total - blockCount) / total) * 100);
  let trafficLight: FlywheelReport["trafficLight"];
  if (health >= 90) trafficLight = "green";
  else if (health >= 60) trafficLight = "yellow";
  else trafficLight = "red";
  const headline = trafficLight === "green"
    ? `🟢 FLYWHEEL ${health}/100 — ${actions.length} action(s), 0 blocking`
    : trafficLight === "yellow"
    ? `🟡 FLYWHEEL ${health}/100 — ${blockCount} blocking action(s) of ${actions.length}`
    : `🔴 FLYWHEEL ${health}/100 — ${blockCount} blocking action(s) of ${actions.length} (publish gate would refuse)`;

  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - t0;

  // ── HMAC-sign + persist ────────────────────────────────────────────
  const body = {
    spec: { name: "MNEME-FLYWHEEL" as const, version: "1.0" },
    startedAt, finishedAt, totalMs,
    harvestCounts,
    fusedCount: fused.length,
    clusterCount,
    actions,
    reciprocity,
    health,
    trafficLight,
    headline,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  const report: FlywheelReport = {
    ...body,
    hmac: lastChainLink,
    seq: parseInt(lastChainLink.slice(0, 8), 16),
    bodyDigest,
  };
  try { storeReport(repoRoot, report); } catch { /* best-effort */ }
  return report;
}

// ── Persistence ────────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "flywheel", "reports");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function storeReport(repoRoot: string, r: FlywheelReport): { path: string; ledger: string } {
  const d = dirOf(repoRoot);
  const stamp = r.finishedAt.replace(/[:.]/g, "-");
  const p = join(d, `${String(r.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(p, JSON.stringify(r, null, 2) + "\n");
  const ledger = join(repoRoot, ".mneme", "flywheel", "reports.jsonl");
  const skim = {
    seq: r.seq, finishedAt: r.finishedAt, totalMs: r.totalMs,
    fusedCount: r.fusedCount, clusterCount: r.clusterCount,
    actionCount: r.actions.length,
    blockingCount: r.actions.filter((a) => a.blocking).length,
    health: r.health, trafficLight: r.trafficLight,
    headline: r.headline,
    hmac: r.hmac, bodyDigest: r.bodyDigest, file: p,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");
  return { path: p, ledger };
}

export interface ReportLedgerEntry {
  seq: number; finishedAt: string; totalMs: number;
  fusedCount: number; clusterCount: number; actionCount: number;
  blockingCount: number; health: number; trafficLight: string;
  headline: string; hmac: string; bodyDigest: string; file: string;
}

export function listReports(repoRoot: string, limit = 30): ReportLedgerEntry[] {
  const p = join(repoRoot, ".mneme", "flywheel", "reports.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: ReportLedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as ReportLedgerEntry); } catch { /* skip */ } }
  return out;
}

export function readLatestReport(repoRoot: string): FlywheelReport | null {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  try { return JSON.parse(readFileSync(join(d, files[files.length - 1]!), "utf8")) as FlywheelReport; }
  catch { return null; }
}

export function verifyReport(card: FlywheelReport, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = card;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

/** Convenience: extract blocking actions only (for ritual gate consumers). */
export function blockingActions(report: FlywheelReport): PrescribedAction[] {
  return report.actions.filter((a) => a.blocking);
}

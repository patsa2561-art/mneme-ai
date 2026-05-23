/**
 * v2.39.0 — Zzzzz-PROBE orchestrator.
 *
 * Fuses anti-entropy + image-provenance + OS-polygraph signals into a
 * single HMAC-signed ZzzzzReport. Composes with HGP: REFUTED /
 * IMPOSSIBLE_REFUTE auto-emits an HGP-YYYY-NNNNN id (best-effort,
 * lazy import to avoid cycles).
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProbeInput, ZzzzzReport, ZzzzzVerdict } from "./types.js";
import { analyzeText } from "./anti_entropy.js";
import { analyzeImage } from "./image_provenance.js";
import { classifyOS } from "./os_polygraph.js";

const HMAC_KEY = process.env["MNEME_ZZZZZ_KEY"] ?? "mneme-zzzzz-probe-v1";
const CHAIN_SEED = "0".repeat(64);
let lastChainLink = CHAIN_SEED;
export function __resetZzzzzChainForTest(): void { lastChainLink = CHAIN_SEED; }

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

function classifyVerdict(score: number): { verdict: ZzzzzVerdict; confidence: number } {
  // Honest threshold ladder (calibrated for false-positive avoidance on
  // short text + natural images):
  //   < 0.40  → CRYSTAL_CLEAR     (no signal)
  //   < 0.55  → PROBE_DRIFT       (warn but don't refute)
  //   < 0.75  → REFUTED           (clear anomaly)
  //   ≥ 0.75  → IMPOSSIBLE_REFUTE (multi-axis stack — auto-HGP)
  if (score >= 0.75) return { verdict: "IMPOSSIBLE_REFUTE", confidence: 0.95 };
  if (score >= 0.55) return { verdict: "REFUTED", confidence: 0.80 };
  if (score >= 0.40) return { verdict: "PROBE_DRIFT", confidence: 0.60 };
  return { verdict: "CRYSTAL_CLEAR", confidence: 0.95 };
}

export async function probeArtifact(input: ProbeInput, repoRoot: string): Promise<ZzzzzReport> {
  const at = new Date().toISOString();
  const os = await classifyOS();
  const caveats: string[] = [];

  let score = 0;
  let textMetrics: ZzzzzReport["textMetrics"];
  let imageProvenance: ZzzzzReport["imageProvenance"];

  if (input.modality === "text" || input.modality === "code") {
    if (!input.text) {
      caveats.push("ZZZZZ_EMPTY_TEXT");
    } else {
      textMetrics = analyzeText(input.text);
      score = textMetrics.anomalyScore;
      if (textMetrics.anomalyScore >= 0.40) caveats.push(`ZZZZZ_TEXT_ANOMALY:${textMetrics.anomalyScore}`);
    }
  } else if (input.modality === "image") {
    if (!input.imageBytes || input.imageBytes.length === 0) {
      caveats.push("ZZZZZ_EMPTY_IMAGE");
    } else {
      imageProvenance = analyzeImage(input.imageBytes);
      score = imageProvenance.suspicionScore;
      if (imageProvenance.suspicionScore >= 0.40) caveats.push(`ZZZZZ_IMAGE_SUSPICION:${imageProvenance.suspicionScore}`);
    }
  }

  const { verdict, confidence } = classifyVerdict(score);
  const headline = verdictHeadline(verdict, score, input.modality);

  // Best-effort HGP auto-record for REFUTED / IMPOSSIBLE_REFUTE.
  let hgpId: string | undefined;
  if (verdict === "REFUTED" || verdict === "IMPOSSIBLE_REFUTE") {
    try {
      // Lazy import to avoid cycle (hgp imports nothing from us).
      const hgp = await import("../hgp/index.js");
      const claimSummary = input.modality === "image"
        ? `IMAGE_SUSPICION:${imageProvenance?.suspicionScore} pHash=${imageProvenance?.pHash} format=${imageProvenance?.format}`
        : `TEXT_ANOMALY:${textMetrics?.anomalyScore} shannon=${textMetrics?.shannonBitsPerChar} rep=${textMetrics?.repetitionRate}`;
      const record = hgp.recordHallucination(repoRoot, {
        claim: claimSummary,
        signature: `zzzzz_probe:${input.modality}:${verdict}`,
        ...(input.vendor ? { vendor: input.vendor } : {}),
      });
      hgpId = record.hgpId;
    } catch { /* HGP unavailable — degrade gracefully */ }
  }

  const body = {
    spec: { name: "MNEME-ZZZZZ-PROBE" as const, version: "1.0" as const },
    modality: input.modality,
    verdict,
    confidence,
    headline,
    ...(textMetrics ? { textMetrics } : {}),
    ...(imageProvenance ? { imageProvenance } : {}),
    os,
    caveats,
    ...(hgpId ? { hgpId } : {}),
    at,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  const report: ZzzzzReport = {
    ...body,
    hmac: lastChainLink,
    seq: parseInt(lastChainLink.slice(0, 8), 16),
    bodyDigest,
  };
  try { persistReport(repoRoot, report); } catch { /* best-effort */ }
  return report;
}

function verdictHeadline(v: ZzzzzVerdict, score: number, modality: string): string {
  if (v === "CRYSTAL_CLEAR") return `💎 CRYSTAL_CLEAR — ${modality} passes Zzzzz-PROBE (score ${(score * 100).toFixed(0)}%)`;
  if (v === "PROBE_DRIFT") return `🟡 PROBE_DRIFT — ${modality} shows mild anomaly (score ${(score * 100).toFixed(0)}%); not refuted but worth a second look`;
  if (v === "REFUTED") return `🔴 REFUTED — ${modality} shows clear AI-generation signal (score ${(score * 100).toFixed(0)}%)`;
  return `💥 IMPOSSIBLE_REFUTE — ${modality} multi-axis anomaly stack (score ${(score * 100).toFixed(0)}%); HGP-ID auto-issued`;
}

// ── Persistence ───────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "zzzzz_probe");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function persistReport(repoRoot: string, r: ZzzzzReport): void {
  appendFileSync(join(dirOf(repoRoot), "ledger.jsonl"), JSON.stringify(r) + "\n");
}

export function readLedger(repoRoot: string, limit = 100): ZzzzzReport[] {
  const p = join(dirOf(repoRoot), "ledger.jsonl");
  if (!existsSync(p)) return [];
  try {
    const out: ZzzzzReport[] = [];
    for (const ln of readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-limit)) {
      try { out.push(JSON.parse(ln) as ZzzzzReport); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

export function verifyReport(r: ZzzzzReport, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = r;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

// ── ARM / DISARM (advisory marker; the real interception is shipped
//    by other primitives like Windows DLL chrysalis or polygraph bridge) ──

export interface ArmState { armed: boolean; at: string; reason?: string; }

export function arm(repoRoot: string, reason?: string): ArmState {
  const state: ArmState = { armed: true, at: new Date().toISOString(), ...(reason ? { reason } : {}) };
  const p = join(dirOf(repoRoot), "armed.json");
  try { appendFileSync(p, JSON.stringify(state) + "\n"); } catch { /* best-effort */ }
  return state;
}

export function disarm(repoRoot: string): ArmState {
  const state: ArmState = { armed: false, at: new Date().toISOString() };
  const p = join(dirOf(repoRoot), "armed.json");
  try { appendFileSync(p, JSON.stringify(state) + "\n"); } catch { /* best-effort */ }
  return state;
}

export function isArmed(repoRoot: string): boolean {
  const p = join(dirOf(repoRoot), "armed.json");
  if (!existsSync(p)) return false;
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    if (lines.length === 0) return false;
    const last = JSON.parse(lines[lines.length - 1]!) as ArmState;
    return !!last.armed;
  } catch { return false; }
}

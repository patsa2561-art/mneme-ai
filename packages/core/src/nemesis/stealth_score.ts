/**
 * v2.52.0 — STEALTH SCORE (Diamond 1 / Million Dollar Secret series).
 *
 * Show mechanic: Eve won by being naturally undetectable — Devin's
 * minimal-diff / empty-PR pattern is so weak NEMESIS can't lock onto
 * her own real identity (0.484 conf), so she SURVIVES even while
 * pretending to be Codex.
 *
 * Mneme primitive: invert NEMESIS classifier confidence into a
 * 0..1 STEALTH SCORE. 0 = wearing a name tag; 1 = perfect ghost.
 *
 * Wild value the user pointed at:
 *   - Privacy mode for OSS contributors who don't want to advertise
 *     "this was AI-assisted"
 *   - Bug-bounty researchers reporting anonymously
 *   - Whistleblower protection — leak code, hide the tool
 *   - INVERSE compliance: HIPAA-mode codebases that LEGALLY can't have
 *     an external AI fingerprint hit → STEALTH SCORE becomes a risk
 *     metric (low stealth = compliance hazard)
 *
 * Wild idea this module adds on top:
 *   ANONYMITY-CREDIT LEDGER. Every commit that scores ≥ 0.7 stealth
 *   EARNS 1 credit, hash-chained. Every "anonymize this commit" call
 *   SPENDS credits. Forensic-evidence-grade anonymity budget so
 *   compliance + privacy claims can be proven against a tamper-evident
 *   record ("you spent 47 stealth credits in Q2 2026, all signed").
 *
 * Composes: classifier_calibrated.classifyAgentCalibrated +
 *           features.extractFingerprint + the cli-activity HMAC pattern.
 *
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { extractFingerprint } from "./features.js";
import { classifyAgentCalibrated } from "./classifier_calibrated.js";
import type { Fingerprint } from "./types.js";

/** Per-fixture stealth verdict. */
export interface StealthVerdict {
  /** 0..1 — inverse of classifier top confidence. */
  stealthScore: number;
  /** Detected top vendor (the would-be unmask). */
  topVendor: string;
  /** Confidence the classifier had — high conf = low stealth. */
  detectionConfidence: number;
  /** Plain-English band. */
  band: "exposed" | "visible" | "partial-cover" | "stealth" | "ghost";
  /** Why this band — one-line evidence. */
  evidence: string;
  /** How many anonymity-credits this fixture would EARN if spent through
   *  the ledger (0 when band is exposed/visible). */
  creditsEarnable: number;
}

/**
 * Compute the stealth verdict for a fingerprint OR for a raw fixture
 * (diff + prDescription + commitMessages). Pure.
 */
export function computeStealthScore(
  input: Fingerprint | { diff: string; prDescription: string; commitMessages: string[] },
): StealthVerdict {
  let fp: Fingerprint;
  if ("multiline_commit_ratio" in input) {
    fp = input as Fingerprint;
  } else {
    fp = extractFingerprint(input as { diff: string; prDescription: string; commitMessages: string[] });
  }
  const verdict = classifyAgentCalibrated(fp);
  const conf = clamp01(verdict.confidence);
  const stealth = 1 - conf;
  const band = bandFor(stealth);
  const creditsEarnable = stealth >= 0.7 ? Math.floor(stealth * 10) : 0;
  const evidence = `${verdict.topVendor} confidence ${conf.toFixed(3)} → stealth ${stealth.toFixed(3)} (${band})`;
  return {
    stealthScore: stealth,
    topVendor: verdict.topVendor,
    detectionConfidence: conf,
    band,
    evidence,
    creditsEarnable,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function bandFor(stealth: number): StealthVerdict["band"] {
  if (stealth < 0.20) return "exposed";
  if (stealth < 0.40) return "visible";
  if (stealth < 0.60) return "partial-cover";
  if (stealth < 0.80) return "stealth";
  return "ghost";
}

// ════════════════════════════════════════════════════════════════════
//  ANONYMITY-CREDIT LEDGER  (the "wild twist")
// ════════════════════════════════════════════════════════════════════

const LEDGER_FILE = ".mneme/nemesis/anonymity_credits.jsonl";
const SEED = "0".repeat(64);
const KEY_ENV = "MNEME_STEALTH_LEDGER_KEY";
const DEFAULT_KEY = "mneme-anonymity-credits-v1";

interface LedgerRow {
  at: string;
  kind: "earn" | "spend";
  amount: number;
  /** What earned/spent — fingerprint hash or commit ref. */
  context: string;
  /** Running balance AFTER this row. */
  balanceAfter: number;
  prev: string;
  hmac: string;
}

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function readLedger(repoRoot: string): LedgerRow[] {
  const path = join(repoRoot, LEDGER_FILE);
  if (!existsSync(path)) return [];
  try {
    const txt = readFileSync(path, "utf8");
    const out: LedgerRow[] = [];
    for (const line of txt.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as LedgerRow); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

function balanceFromLedger(rows: LedgerRow[]): number {
  if (rows.length === 0) return 0;
  return rows[rows.length - 1]!.balanceAfter;
}

function appendLedger(repoRoot: string, row: Omit<LedgerRow, "prev" | "hmac" | "balanceAfter">, balanceAfter: number): LedgerRow {
  try { mkdirSync(join(repoRoot, ".mneme/nemesis"), { recursive: true }); } catch { /* ok */ }
  const existing = readLedger(repoRoot);
  const prev = existing.length === 0 ? SEED : existing[existing.length - 1]!.hmac;
  const body = { ...row, balanceAfter, prev };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  const full: LedgerRow = { ...body, hmac };
  try {
    appendFileSync(join(repoRoot, LEDGER_FILE), JSON.stringify(full) + "\n");
  } catch { /* best-effort */ }
  return full;
}

/** Earn credits from a stealth verdict (no-op when band too visible). */
export function earnAnonymityCredits(
  repoRoot: string,
  verdict: StealthVerdict,
  contextRef: string,
): { earned: number; newBalance: number; rejected?: string } {
  if (verdict.creditsEarnable <= 0) {
    return { earned: 0, newBalance: balanceFromLedger(readLedger(repoRoot)), rejected: `band="${verdict.band}" is below earning threshold` };
  }
  const balanceBefore = balanceFromLedger(readLedger(repoRoot));
  const newBalance = balanceBefore + verdict.creditsEarnable;
  appendLedger(repoRoot, {
    at: new Date().toISOString(),
    kind: "earn",
    amount: verdict.creditsEarnable,
    context: `${contextRef} @ stealth=${verdict.stealthScore.toFixed(3)} (${verdict.band})`,
  }, newBalance);
  return { earned: verdict.creditsEarnable, newBalance };
}

/** Spend credits for an anonymize action. Returns insufficient when low. */
export function spendAnonymityCredits(
  repoRoot: string,
  amount: number,
  contextRef: string,
): { spent: number; newBalance: number; rejected?: string } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { spent: 0, newBalance: balanceFromLedger(readLedger(repoRoot)), rejected: "amount must be > 0" };
  }
  const balanceBefore = balanceFromLedger(readLedger(repoRoot));
  if (balanceBefore < amount) {
    return { spent: 0, newBalance: balanceBefore, rejected: `insufficient: have ${balanceBefore}, need ${amount}` };
  }
  const newBalance = balanceBefore - amount;
  appendLedger(repoRoot, {
    at: new Date().toISOString(),
    kind: "spend",
    amount,
    context: contextRef,
  }, newBalance);
  return { spent: amount, newBalance };
}

/** Current balance + last 10 rows for diagnostics. */
export function stealthCreditStatus(repoRoot: string): {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastRows: LedgerRow[];
} {
  const rows = readLedger(repoRoot);
  let earned = 0;
  let spent = 0;
  for (const r of rows) {
    if (r.kind === "earn") earned += r.amount;
    else spent += r.amount;
  }
  return {
    balance: balanceFromLedger(rows),
    totalEarned: earned,
    totalSpent: spent,
    lastRows: rows.slice(-10),
  };
}

/** Verify the HMAC chain of the anonymity ledger (tamper-evident). */
export function verifyStealthLedger(repoRoot: string): { ok: boolean; rows: number; brokenAt?: number; reason?: string } {
  const rows = readLedger(repoRoot);
  let prev = SEED;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const { hmac, ...body } = r;
    if (body.prev !== prev) return { ok: false, rows: i, brokenAt: i, reason: "prev mismatch" };
    const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i, reason: "hmac mismatch" };
    prev = hmac;
  }
  return { ok: true, rows: rows.length };
}

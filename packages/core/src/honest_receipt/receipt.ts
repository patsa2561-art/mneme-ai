/**
 * v2.36.0 — Build + verify HONEST RECEIPTs.
 *
 * Pure functions over already-snapshotted data. The CLI calls
 * snapshotInstall() + measures latency itself, then assembles a
 * receipt via buildReceipt(). HMAC chain not required (each receipt
 * is standalone); we just HMAC-sign the canonical body so the
 * receipt is tamper-evident.
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { HonestReceipt, InstallSnapshot, LatencyReport } from "./types.js";

const HMAC_KEY = process.env["MNEME_HONEST_RECEIPT_KEY"] ?? "mneme-honest-receipt-v1";

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function hmacOf(s: string): string { return createHmac("sha256", HMAC_KEY).update(s).digest("hex"); }

export interface BuildReceiptInput {
  cmd: string;
  args: string[];
  install: InstallSnapshot;
  latency: LatencyReport;
}

/** Sanitize args — strip anything that looks like a secret. */
function sanitizeArgs(args: string[]): string[] {
  const SECRET_RX = /(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+)/gi;
  return args.map((a) => a.replace(SECRET_RX, "<redacted>"));
}

export function buildReceipt(input: BuildReceiptInput): HonestReceipt {
  const at = new Date().toISOString();
  const body = {
    spec: { name: "MNEME-HONEST-RECEIPT" as const, version: "1.0" as const },
    cmd: input.cmd,
    args: sanitizeArgs(input.args),
    install: input.install,
    latency: input.latency,
    at,
  };
  const hmac = hmacOf(canon(body));
  return { ...body, hmac };
}

export function verifyReceipt(receipt: HonestReceipt): { ok: boolean; reason?: string } {
  try {
    const { hmac, ...body } = receipt;
    const expected = hmacOf(canon(body));
    if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `verify error: ${(e as Error).message}` };
  }
}

/** Append receipt to ledger (best-effort; never throws). */
export function appendReceipt(repoRoot: string, receipt: HonestReceipt): { ok: boolean; path: string } {
  const dir = join(repoRoot, ".mneme", "honest_receipt");
  const path = join(dir, "ledger.jsonl");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(receipt) + "\n");
    return { ok: true, path };
  } catch {
    return { ok: false, path };
  }
}

export function readLedger(repoRoot: string, limit = 100): HonestReceipt[] {
  const p = join(repoRoot, ".mneme", "honest_receipt", "ledger.jsonl");
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-limit);
    const out: HonestReceipt[] = [];
    for (const ln of lines) {
      try { out.push(JSON.parse(ln) as HonestReceipt); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** Aggregate latency stats from the ledger (median + p95 + path histogram). */
export interface LatencyStats {
  count: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  byPath: Record<string, { count: number; medianMs: number }>;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function aggregateLatency(receipts: HonestReceipt[]): LatencyStats {
  const all = receipts.map((r) => r.latency.totalMs);
  const byPath: Record<string, number[]> = {};
  for (const r of receipts) {
    const p = r.latency.codePath;
    (byPath[p] ??= []).push(r.latency.totalMs);
  }
  return {
    count: all.length,
    medianMs: Math.round(median(all)),
    p95Ms: Math.round(percentile(all, 0.95)),
    meanMs: all.length === 0 ? 0 : Math.round(all.reduce((s, n) => s + n, 0) / all.length),
    byPath: Object.fromEntries(Object.entries(byPath).map(([k, xs]) => [k, { count: xs.length, medianMs: Math.round(median(xs)) }])),
  };
}

/** Tiny convenience: hash some text for IDs/keys. */
export function shortHash(s: string): string {
  return sha(s).slice(0, 12);
}

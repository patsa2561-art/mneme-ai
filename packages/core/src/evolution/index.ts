/**
 * v2.19.2 — MNEME EVOLUTION LEDGER (พ่อแม่วัดลูกทุกวัน)
 *
 *   "Each day, Mneme records a signed growth snapshot: how many MCP
 *    tools it now exposes, how many tests it now passes, how many
 *    AURELIAN-graded SHIPs it has shipped, how many ritual gates exist,
 *    how many bug classes it now defends against. Daily deltas form
 *    an HMAC-chained ledger — child report card the parent can read.
 *
 *    The parent (AI agent + user) reads the ledger and answers:
 *    'Is the child smarter today than yesterday? By how much? In what
 *    dimension?' Growth becomes a recomputable, falsifiable claim."
 *
 * Vendor-agnostic, file-system-based, no external deps. Chain-signed
 * for tamper-evidence (like v2.19 BOOMERANG ledger). Persists to
 * `.mneme/evolution.jsonl` by default.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export interface GrowthSnapshot {
  v: typeof PROTOCOL_VERSION;
  snapshotId: string;
  /** YYYY-MM-DD; one canonical snapshot per day (re-recording overwrites). */
  day: string;
  /** Free-form metrics; caller decides what to track. */
  metrics: {
    mnemeVersion: string;
    mcpToolCount: number;
    coreModuleCount: number;
    testCount: number;
    ritualGateCount: number;
    aurelianShipCount: number;
    vendorCount: number;
    /** Any extra dim the caller wants. */
    extra?: Record<string, number | string>;
  };
  /** Computed delta from prior day's snapshot. null on first ever. */
  delta: null | Record<string, number>;
  /** Chain link to previous snapshot's sig. */
  prevSig: string;
  ts: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_EVOLUTION_SECRET"] || `mneme-evolution-ledger-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function computeDelta(curr: GrowthSnapshot["metrics"], prev: GrowthSnapshot["metrics"] | null): Record<string, number> | null {
  if (!prev) return null;
  const out: Record<string, number> = {};
  for (const k of ["mcpToolCount", "coreModuleCount", "testCount", "ritualGateCount", "aurelianShipCount", "vendorCount"] as const) {
    const a = Number(curr[k]) || 0;
    const b = Number(prev[k]) || 0;
    out[k] = a - b;
  }
  return out;
}

export class EvolutionLedger {
  private ledgerPath: string;
  private ledger: GrowthSnapshot[] = [];
  private secret: string;

  constructor(opts: { ledgerPath?: string; secret?: string } = {}) {
    this.ledgerPath = opts.ledgerPath ?? ".mneme/evolution.jsonl";
    this.secret = opts.secret ?? defaultSecret();
    this.loadIfExists();
  }

  private loadIfExists(): void {
    if (!existsSync(this.ledgerPath)) return;
    const text = readFileSync(this.ledgerPath, "utf8");
    for (const line of text.split("\n")) {
      const trim = line.trim();
      if (!trim) continue;
      try {
        const rec = JSON.parse(trim) as GrowthSnapshot;
        this.ledger.push(rec);
      } catch { /* skip malformed */ }
    }
  }

  /** Record a daily growth snapshot. Idempotent per day (replaces if exists). */
  record(input: {
    day?: string;
    metrics: GrowthSnapshot["metrics"];
    nowMs?: number;
  }): GrowthSnapshot {
    const now = input.nowMs ?? Date.now();
    const day = input.day ?? new Date(now).toISOString().slice(0, 10);
    // Drop existing same-day entry if present (idempotent).
    this.ledger = this.ledger.filter((s) => s.day !== day);
    const prev = this.ledger[this.ledger.length - 1] ?? null;
    const delta = computeDelta(input.metrics, prev ? prev.metrics : null);
    const prevSig = prev ? prev.sig : "genesis".padEnd(64, "0");
    const snapshotId = "evo-" + createHmac("sha256", "mneme-evo-id")
      .update(`${day}|${this.ledger.length}|${input.metrics.mnemeVersion}`)
      .digest("hex").slice(0, 14);
    const body: Omit<GrowthSnapshot, "sig"> = {
      v: PROTOCOL_VERSION,
      snapshotId,
      day,
      metrics: input.metrics,
      delta,
      prevSig,
      ts: new Date(now).toISOString(),
    };
    const sig = hmac(body, this.secret);
    const snap: GrowthSnapshot = { ...body, sig };
    this.ledger.push(snap);
    this.persistDelta(snap);
    return snap;
  }

  private persistDelta(snap: GrowthSnapshot): void {
    try {
      mkdirSync(dirname(this.ledgerPath), { recursive: true });
      // Rewrite full ledger to honour the idempotency rule (replace same-day).
      const text = this.ledger.map((s) => JSON.stringify(s)).join("\n") + "\n";
      writeFileSync(this.ledgerPath, text, "utf8");
    } catch { /* best-effort */ }
  }

  /** Last N snapshots (most recent first). */
  recent(n: number = 7): GrowthSnapshot[] {
    return this.ledger.slice(-n).reverse();
  }

  /** Verify any single snapshot's signature. */
  verify(s: GrowthSnapshot): boolean {
    const { sig: claimed, ...body } = s;
    const expected = hmac(body, this.secret);
    try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
    catch { return false; }
  }

  /** Verify the full chain integrity. */
  verifyChain(): { ok: boolean; brokenAt?: number; reason?: string } {
    for (let i = 0; i < this.ledger.length; i++) {
      const rec = this.ledger[i]!;
      if (!this.verify(rec)) return { ok: false, brokenAt: i, reason: "sig mismatch" };
      if (i === 0) {
        if (rec.prevSig !== "genesis".padEnd(64, "0")) return { ok: false, brokenAt: 0, reason: "genesis wrong" };
      } else {
        const prev = this.ledger[i - 1]!;
        if (rec.prevSig !== prev.sig) return { ok: false, brokenAt: i, reason: "chain link mismatch" };
      }
    }
    return { ok: true };
  }

  /** Human-readable report card for parent. */
  reportCard(n: number = 7): string {
    const recent = this.recent(n);
    if (recent.length === 0) return "📊 EVOLUTION · no snapshots yet — start with `record()`";
    const lines = [`📊 MNEME GROWTH · last ${recent.length} snapshot(s):`];
    for (const s of recent) {
      const d = s.delta;
      const deltaStr = d
        ? `Δtools=${d.mcpToolCount! >= 0 ? "+" : ""}${d.mcpToolCount} · Δtests=${d.testCount! >= 0 ? "+" : ""}${d.testCount} · Δgates=${d.ritualGateCount! >= 0 ? "+" : ""}${d.ritualGateCount}`
        : "(first ever — no delta)";
      lines.push(`  ${s.day} · v${s.metrics.mnemeVersion} · tools=${s.metrics.mcpToolCount} tests=${s.metrics.testCount} gates=${s.metrics.ritualGateCount} · ${deltaStr}`);
    }
    return lines.join("\n");
  }
}

export function formatGrowthLine(s: GrowthSnapshot): string {
  const d = s.delta;
  const deltaStr = d ? ` · Δtools=${d.mcpToolCount! >= 0 ? "+" : ""}${d.mcpToolCount}` : "";
  return `📊 EVOLUTION · ${s.day} · v${s.metrics.mnemeVersion} · ${s.metrics.mcpToolCount} tools${deltaStr}`;
}

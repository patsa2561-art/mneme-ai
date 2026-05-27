/**
 * 🩸 PROTOPLASM — WAL (Write-Ahead Log)
 *
 * Survives uncatchable kills (SIGKILL, SIGSEGV, OS reboot).
 *
 * Strategy: every baseline mutation persists to disk BEFORE RAM update.
 * Process death = baseline survives. Next start reads WAL → reconstructs.
 *
 * WAL format: append-only JSONL at .mneme/protoplasm/wal.jsonl
 * Each row = { ts, fnId, op, payload, prevHmac, hmac }
 *
 * Compaction: when WAL exceeds 5MB, snapshot baselines to baselines.json
 * + truncate WAL to entries since snapshot.
 */

import { existsSync, statSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import type { FunctionBaseline } from "./types.js";

export type WalOp = "baseline_set" | "buffer_evict" | "config_set";

export interface WalRow {
  ts: string;
  fnId: string;
  op: WalOp;
  payload: unknown;
  prevHmac: string;
  hmac: string;
}

/** Recursive canonical JSON: sort all keys at every depth, drop undefined. */
function canonical(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const val = (v as Record<string, unknown>)[k];
    if (val !== undefined) out[k] = canonical(val);
  }
  return out;
}

function hmacRow(prev: string, body: Omit<WalRow, "hmac">, secret: string): string {
  const canon = JSON.stringify(canonical(body));
  return createHmac("sha256", secret).update(prev + "::" + canon).digest("hex").slice(0, 16);
}

export class Wal {
  private path: string;
  private secret: string;
  private lastHmac = "0".repeat(16);
  private compactionThresholdBytes = 5 * 1024 * 1024;  // 5MB

  constructor(walDir: string, secret: string) {
    mkdirSync(walDir, { recursive: true });
    this.path = join(walDir, "wal.jsonl");
    this.secret = secret;
    this.lastHmac = this.computeLastHmac();
  }

  private computeLastHmac(): string {
    if (!existsSync(this.path)) return "0".repeat(16);
    try {
      const content = readFileSync(this.path, "utf8").trim();
      if (!content) return "0".repeat(16);
      const lines = content.split("\n");
      const last = JSON.parse(lines[lines.length - 1]) as WalRow;
      return last.hmac;
    } catch { return "0".repeat(16); }
  }

  /** Append op to WAL. Synchronous + flush — survives unexpected death. */
  append(op: WalOp, fnId: string, payload: unknown): WalRow {
    const body = { ts: new Date().toISOString(), fnId, op, payload, prevHmac: this.lastHmac };
    const hmac = hmacRow(this.lastHmac, body, this.secret);
    const row: WalRow = { ...body, hmac };
    appendFileSync(this.path, JSON.stringify(row) + "\n", { encoding: "utf8", flush: true });
    this.lastHmac = hmac;
    this.maybeCompact();
    return row;
  }

  /** Replay WAL → reconstruct baseline map. Idempotent. */
  replay(): Map<string, FunctionBaseline> {
    const baselines = new Map<string, FunctionBaseline>();
    const snapshotPath = this.path.replace("wal.jsonl", "baselines.json");
    // Load snapshot first (compaction product)
    if (existsSync(snapshotPath)) {
      try {
        const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, FunctionBaseline>;
        for (const [k, v] of Object.entries(snap)) baselines.set(k, v);
      } catch { /* ignore corrupt snapshot — fall back to full WAL */ }
    }
    if (!existsSync(this.path)) return baselines;
    const content = readFileSync(this.path, "utf8").trim();
    if (!content) return baselines;
    for (const line of content.split("\n")) {
      try {
        const row = JSON.parse(line) as WalRow;
        if (row.op === "baseline_set") baselines.set(row.fnId, row.payload as FunctionBaseline);
      } catch { /* skip malformed */ }
    }
    return baselines;
  }

  /** Verify chain integrity (chain HMAC continuity). */
  verify(): { ok: boolean; rows: number; brokenAt?: number } {
    if (!existsSync(this.path)) return { ok: true, rows: 0 };
    const lines = readFileSync(this.path, "utf8").trim().split("\n").filter(Boolean);
    let prev = "0".repeat(16);
    for (let i = 0; i < lines.length; i++) {
      try {
        const row = JSON.parse(lines[i]) as WalRow;
        if (row.prevHmac !== prev) return { ok: false, rows: lines.length, brokenAt: i };
        const { hmac, ...body } = row;
        const recomputed = hmacRow(prev, body, this.secret);
        if (recomputed !== hmac) return { ok: false, rows: lines.length, brokenAt: i };
        prev = hmac;
      } catch { return { ok: false, rows: lines.length, brokenAt: i }; }
    }
    return { ok: true, rows: lines.length };
  }

  /** Compact WAL → snapshot if file exceeds threshold. */
  private maybeCompact(): void {
    try {
      const sz = statSync(this.path).size;
      if (sz < this.compactionThresholdBytes) return;
      const baselines = this.replay();
      const snapshotPath = this.path.replace("wal.jsonl", "baselines.json");
      const obj: Record<string, FunctionBaseline> = {};
      for (const [k, v] of baselines) obj[k] = v;
      writeFileSync(snapshotPath, JSON.stringify(obj), "utf8");
      // Truncate WAL atomically: write empty + reset chain
      const tmpPath = this.path + ".tmp";
      writeFileSync(tmpPath, "", "utf8");
      renameSync(tmpPath, this.path);
      this.lastHmac = "0".repeat(16);
    } catch { /* compaction is best-effort */ }
  }

  path_for_test(): string { return this.path; }
}

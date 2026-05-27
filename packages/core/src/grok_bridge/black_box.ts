/**
 * 💥 1. GROK BLACK BOX FLIGHT RECORDER
 *
 * Per-token HMAC stamping. Sub-millisecond per chunk.
 * Output: tamper-evident JSONL ledger that survives any audit demand.
 */

import { createHmac, createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { BlackBoxStamp, BlackBoxStampInput } from "./types.js";

function canonical(o: unknown): string {
  if (o === undefined) return "null";   // treat undefined as null in canonical form
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonical).join(",") + "]";
  // skip undefined-valued keys for deterministic output
  return "{" + Object.keys(o as object)
    .filter((k) => (o as any)[k] !== undefined)
    .sort()
    .map((k) => JSON.stringify(k) + ":" + canonical((o as any)[k]))
    .join(",") + "}";
}

export class GrokBlackBox {
  private lastHmac: string;

  constructor(private ledgerPath: string, private secret: string) {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    this.lastHmac = this.computeLastHmac();
  }

  private computeLastHmac(): string {
    if (!existsSync(this.ledgerPath)) return "0".repeat(16);
    try {
      const txt = readFileSync(this.ledgerPath, "utf8").trim();
      if (!txt) return "0".repeat(16);
      const lines = txt.split("\n");
      const last = JSON.parse(lines[lines.length - 1]) as BlackBoxStamp;
      return last.hmac;
    } catch { return "0".repeat(16); }
  }

  /** Stamp a token chunk. Returns the stamp for caller to attach if needed. */
  stamp(input: BlackBoxStampInput): BlackBoxStamp {
    const tokenChunk = input.outputTokens.join("");
    const body: Omit<BlackBoxStamp, "hmac"> = {
      ts: new Date().toISOString(),
      modelVersion: input.modelVersion,
      promptHash: input.promptHash,
      tokenChunkHash: createHash("sha256").update(tokenChunk).digest("hex").slice(0, 16),
      tokenCount: input.outputTokens.length,
      sessionId: input.sessionId,
      ragSources: input.ragSources,
      prev: this.lastHmac,
    };
    const hmac = createHmac("sha256", this.secret).update(this.lastHmac + "::" + canonical(body)).digest("hex").slice(0, 16);
    const stamp: BlackBoxStamp = { ...body, hmac };
    try { appendFileSync(this.ledgerPath, JSON.stringify(stamp) + "\n", { encoding: "utf8", flush: true }); }
    catch { /* best-effort — never block inference */ }
    this.lastHmac = hmac;
    return stamp;
  }

  /** Verify the full chain (for audit / regulator queries). */
  verifyChain(): { ok: boolean; rows: number; brokenAt?: number } {
    if (!existsSync(this.ledgerPath)) return { ok: true, rows: 0 };
    const lines = readFileSync(this.ledgerPath, "utf8").trim().split("\n").filter(Boolean);
    let prev = "0".repeat(16);
    for (let i = 0; i < lines.length; i++) {
      try {
        const row = JSON.parse(lines[i]) as BlackBoxStamp;
        if (row.prev !== prev) return { ok: false, rows: lines.length, brokenAt: i };
        const { hmac, ...body } = row;
        const expected = createHmac("sha256", this.secret).update(prev + "::" + canonical(body)).digest("hex").slice(0, 16);
        if (expected !== hmac) return { ok: false, rows: lines.length, brokenAt: i };
        prev = hmac;
      } catch { return { ok: false, rows: lines.length, brokenAt: i }; }
    }
    return { ok: true, rows: lines.length };
  }

  /** Playback: find all stamps for a given session + time window. */
  playback(opts: { sessionId?: string; fromTs?: string; toTs?: string }): BlackBoxStamp[] {
    if (!existsSync(this.ledgerPath)) return [];
    const lines = readFileSync(this.ledgerPath, "utf8").trim().split("\n").filter(Boolean);
    const out: BlackBoxStamp[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as BlackBoxStamp;
        if (opts.sessionId && row.sessionId !== opts.sessionId) continue;
        if (opts.fromTs && row.ts < opts.fromTs) continue;
        if (opts.toTs && row.ts > opts.toTs) continue;
        out.push(row);
      } catch { /* skip */ }
    }
    return out;
  }
}

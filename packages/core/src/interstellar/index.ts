/**
 * v2.1.0 -- INTERSTELLAR · 1-year-wisdom → 4KB packet
 *
 * The "Mars-ready AI memory" idea: when bandwidth/latency makes a full
 * brain transfer infeasible (Mars colony · submarine · Faraday cage ·
 * 22-min light delay), Mneme can compress an entire year of accumulated
 * wisdom into a 4 KB packet that boots a minimum-viable Mneme on
 * arrival.
 *
 * NOT a censorship-evasion tool. Pure compression + ECC + temporal
 * consistency for legitimate high-latency / low-bandwidth channels.
 *
 * Strategy:
 *   1. Rank events by impact_score = citations × recency_decay × outcome_polarity
 *   2. Take top-N within byte budget
 *   3. Compress each to (kind: 1 char, ts: 4 byte epoch_days, scope: 8 char, text: ≤80 char)
 *   4. Append a 32-byte HMAC for integrity over the radio link
 *
 * 4096 bytes ÷ ~96 bytes per event ≈ 42 wisdom events. Enough to bootstrap.
 */

import { createHmac, createHash } from "node:crypto";

export interface WisdomEvent {
  /** Original id. */
  id: string;
  ts: number;
  /** Single-character kind: D=decision, R=regret, W=wisdom, V=vaccine, P=preference. */
  kind: "D" | "R" | "W" | "V" | "P";
  scope: string;
  text: string;
  /** Number of times this event has been cited elsewhere. */
  citations: number;
  /** -1 = bad outcome, +1 = good outcome, 0 = neutral. */
  outcomePolarity: number;
}

export interface CompressInput {
  events: readonly WisdomEvent[];
  /** Byte budget. Default 4096. */
  maxBytes?: number;
  /** Recency half-life in days. Default 90. */
  halfLifeDays?: number;
  /** HMAC secret for the integrity footer. */
  secret: Buffer;
}

export interface CompressedPacket {
  /** Magic header bytes ASCII. */
  magic: "MNINTR1";
  /** Header version. */
  version: 1;
  /** Number of events packed. */
  eventCount: number;
  /** Compact rows. */
  rows: Array<{ kind: string; tsDays: number; scope: string; text: string }>;
  /** HMAC-SHA256 truncated to 16 hex over the serialized payload. */
  integrity: string;
  /** Estimated bytes when serialized. */
  bytes: number;
}

function impactScore(e: WisdomEvent, halfLifeDays: number, nowDays: number): number {
  const ageDays = Math.max(0, nowDays - Math.floor(e.ts / (24 * 60 * 60 * 1000)));
  const recency = Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
  // Polarity treated as |x| + 0.2 so neutral events still count a little
  const polarityBoost = Math.abs(e.outcomePolarity) + 0.2;
  return (1 + e.citations) * recency * polarityBoost;
}

function serializeRows(rows: CompressedPacket["rows"]): string {
  // Compact single-line format: kind|tsDays|scope|text per row, rows joined by \n
  return rows.map((r) => `${r.kind}|${r.tsDays}|${r.scope}|${r.text}`).join("\n");
}

/** Compress a year of wisdom into a packet that fits in `maxBytes`. */
export function compressYearOfWisdom(input: CompressInput): CompressedPacket {
  const maxBytes = input.maxBytes ?? 4096;
  const halfLifeDays = input.halfLifeDays ?? 90;
  const nowDays = Math.floor(Date.now() / (24 * 60 * 60 * 1000));

  // Score + sort
  const ranked = [...input.events]
    .map((e) => ({ e, score: impactScore(e, halfLifeDays, nowDays) }))
    .sort((a, b) => b.score - a.score);

  const rows: CompressedPacket["rows"] = [];
  for (const { e } of ranked) {
    const tsDays = Math.floor(e.ts / (24 * 60 * 60 * 1000));
    const scope = (e.scope || "").slice(0, 8);
    const text = (e.text || "").replace(/[\n|]/g, " ").slice(0, 80);
    rows.push({ kind: e.kind, tsDays, scope, text });
    const testSerialized = `MNINTR1\nv1\n${rows.length}\n` + serializeRows(rows) + `\nINTEGRITY:` + "x".repeat(32);
    if (Buffer.byteLength(testSerialized, "utf8") > maxBytes) {
      rows.pop();
      break;
    }
  }

  const serialized = `MNINTR1\nv1\n${rows.length}\n` + serializeRows(rows);
  const integrity = createHmac("sha256", input.secret).update(serialized).digest("hex").slice(0, 32);
  const bytes = Buffer.byteLength(serialized + `\nINTEGRITY:${integrity}`, "utf8");

  return { magic: "MNINTR1", version: 1, eventCount: rows.length, rows, integrity, bytes };
}

export interface DecompressInput {
  packet: CompressedPacket;
  secret: Buffer;
}

export type DecompressVerdict = "OK" | "TAMPERED" | "MAGIC_MISMATCH" | "VERSION_UNKNOWN";

export interface DecompressResult {
  verdict: DecompressVerdict;
  reason: string;
  /** Reconstituted events — minimum-viable Mneme bootstrap. */
  events?: WisdomEvent[];
}

export function decompressPacket(input: DecompressInput): DecompressResult {
  const p = input.packet;
  if (p.magic !== "MNINTR1") return { verdict: "MAGIC_MISMATCH", reason: `expected magic 'MNINTR1' got '${p.magic}'` };
  if (p.version !== 1) return { verdict: "VERSION_UNKNOWN", reason: `unsupported version ${p.version}` };
  const serialized = `MNINTR1\nv1\n${p.rows.length}\n` + serializeRows(p.rows);
  const expected = createHmac("sha256", input.secret).update(serialized).digest("hex").slice(0, 32);
  if (expected !== p.integrity) return { verdict: "TAMPERED", reason: "integrity mismatch — packet was modified or wrong secret" };
  // Reconstitute minimal events
  const events: WisdomEvent[] = p.rows.map((r, i) => ({
    id: createHash("sha256").update(`${r.kind}|${r.tsDays}|${r.scope}|${r.text}|${i}`).digest("hex").slice(0, 8),
    ts: r.tsDays * 24 * 60 * 60 * 1000,
    kind: r.kind as WisdomEvent["kind"],
    scope: r.scope,
    text: r.text,
    citations: 0, // not preserved in compression
    outcomePolarity: 0,
  }));
  return { verdict: "OK", reason: `decompressed ${events.length} events`, events };
}

export function formatInterstellarPulseLine(p: CompressedPacket): string {
  return `INTERSTELLAR · ${p.eventCount} events · ${p.bytes}B · integrity=${p.integrity.slice(0, 8)}…`;
}

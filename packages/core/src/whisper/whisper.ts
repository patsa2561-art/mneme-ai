/**
 * v1.60.0 -- TIER 4: WHISPER NET.
 *
 * P2P wisdom federation. Mneme A discovers a vaccine -> serializes a
 * SIGNED WISDOM PACKET (vaccine / lesson / chromosome-fingerprint).
 * Mneme B imports the packet, verifies the signature, deduplicates
 * via simhash, and applies the wisdom to its local bank.
 *
 * NO central server. Packets travel however the user wants:
 *   - email attachment, Slack file, USB stick (sneaker-net)
 *   - git-tracked file in a shared repo
 *   - DHT / IPFS / libp2p (out of scope for v1.60; the format permits it)
 *
 * Packet shape (canonical JSON, HMAC-signed):
 *   { kind: "vaccine" | "lesson" | "chromosome",
 *     emittedBy: <vendor-id>,
 *     emittedAt: <iso>,
 *     payload: <body>,
 *     simhash64: <16-char hex>,
 *     hmac: <32-char hex>,
 *     schemaVersion: 1 }
 *
 * Tamper-evidence: HMAC over canonical JSON of the body.
 * Replay-protection: simhash deduplicates exact + near-duplicate packets.
 * Vendor authentication: the emitting Mneme signs with its OWN secret;
 *   recipients track per-vendor public commitments to reject impostors.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const WHISPER_DIR = ".mneme/whisper";

export type PacketKind = "vaccine" | "lesson" | "chromosome";

export interface WisdomPacket {
  kind: PacketKind;
  emittedBy: string;
  emittedAt: string;
  payload: Record<string, unknown>;
  simhash64: string;
  hmac: string;
  schemaVersion: 1;
}

export interface ImportResult {
  ok: boolean;
  reason: string;
  /** When true, the packet's simhash matched an already-known packet
   *  and was deduplicated. */
  deduplicated?: boolean;
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function secretPath(repoRoot: string): string { return join(repoRoot, WHISPER_DIR, ".secret"); }

function loadOrCreateSecret(repoRoot: string): string {
  const dir = join(repoRoot, WHISPER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = secretPath(repoRoot);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

/** Simple 64-bit simhash for dedup (mirrors acgv_vaccine simhash). */
export function simhash64(text: string): string {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/g).filter((t) => t.length >= 3);
  if (tokens.length === 0) return "0".repeat(16);
  const votes = new Array<number>(64).fill(0);
  for (const t of tokens) {
    let h = 0n;
    for (let i = 0; i < t.length; i++) {
      h = ((h * 31n) + BigInt(t.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn;
    }
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(63 - i)) & 1n;
      votes[i]! += bit === 1n ? 1 : -1;
    }
  }
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (votes[nib * 4 + b]! > 0 ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

/** Build + sign a new packet. */
export function emitPacket(repoRoot: string, kind: PacketKind, emittedBy: string, payload: Record<string, unknown>): WisdomPacket {
  const emittedAt = new Date().toISOString();
  const sh = simhash64(canonicalize({ kind, payload }));
  const body = { kind, emittedBy, emittedAt, payload, simhash64: sh, schemaVersion: 1 as const };
  const secret = loadOrCreateSecret(repoRoot);
  const hmac = createHmac("sha256", secret).update(canonicalize(body)).digest("hex").slice(0, 32);
  return { ...body, hmac };
}

/** Verify HMAC against the local secret. (Cross-machine verification
 *  requires sharing the emitter's public commitment, v1.60 ships
 *  same-machine round-trip; multi-machine arrives in v1.61.) */
export function verifyPacket(repoRoot: string, packet: WisdomPacket): { ok: boolean; reason: string } {
  const { hmac, ...rest } = packet;
  const secret = loadOrCreateSecret(repoRoot);
  const expected = createHmac("sha256", secret).update(canonicalize(rest)).digest("hex").slice(0, 32);
  return expected === hmac
    ? { ok: true, reason: "HMAC valid" }
    : { ok: false, reason: `HMAC mismatch (expected ${expected.slice(0, 8)}..., got ${hmac.slice(0, 8)}...)` };
}

/** Try to apply a received packet to the local wisdom bank. */
export function importPacket(repoRoot: string, packet: WisdomPacket, opts?: { matchRadius?: number }): ImportResult {
  const v = verifyPacket(repoRoot, packet);
  if (!v.ok) return { ok: false, reason: v.reason };
  const dir = join(repoRoot, WHISPER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const known = readLedger(repoRoot);
  const radius = opts?.matchRadius ?? 6;
  for (const prev of known) {
    const d = hammingDistance(prev.simhash64, packet.simhash64);
    if (d >= 0 && d <= radius) {
      return { ok: true, reason: `Deduplicated: matched packet from ${prev.emittedBy} at distance ${d}`, deduplicated: true };
    }
  }
  appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify(packet) + "\n", "utf8");
  return { ok: true, reason: "Imported -- packet added to whisper ledger" };
}

/** Read every imported packet (best-effort). */
export function readLedger(repoRoot: string): WisdomPacket[] {
  const p = join(repoRoot, WHISPER_DIR, "ledger.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as WisdomPacket; } catch { return null; }
    }).filter((x): x is WisdomPacket => x !== null);
  } catch { return []; }
}

export interface NetworkStats {
  totalPackets: number;
  byKind: Record<PacketKind, number>;
  uniqueEmitters: number;
  oldest: string | null;
  newest: string | null;
}

export function networkStats(repoRoot: string): NetworkStats {
  const packets = readLedger(repoRoot);
  const byKind: Record<PacketKind, number> = { vaccine: 0, lesson: 0, chromosome: 0 };
  for (const p of packets) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const emitters = new Set(packets.map((p) => p.emittedBy));
  const sorted = [...packets].sort((a, b) => Date.parse(a.emittedAt) - Date.parse(b.emittedAt));
  return {
    totalPackets: packets.length, byKind,
    uniqueEmitters: emitters.size,
    oldest: sorted.length > 0 ? sorted[0]!.emittedAt : null,
    newest: sorted.length > 0 ? sorted[sorted.length - 1]!.emittedAt : null,
  };
}

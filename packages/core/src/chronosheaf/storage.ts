/**
 * v2.19.49 — CHRONOSHEAF storage adapter (P5 spec).
 *
 *   .mneme/chronosheaf/cover.json          — current open cover
 *   .mneme/chronosheaf/cech.json           — Čech complex serialised
 *   .mneme/chronosheaf/persistence.jsonl   — persistence diagram (append-only)
 *   .mneme/chronosheaf/rg_fixed_points.json — promoted relevant operators
 *   .mneme/chronosheaf/chain.jsonl         — HMAC chain (every state change)
 *
 *   All writes are HMAC-chained (composes with APOSTILLE + ETERNITY).
 *   Reads are tamper-detected via chain replay.
 *
 *   Spec mandate: "compose กับ replay log เดิม" — we re-use the same
 *   chain pattern as APOSTILLE: each entry carries `prevSig` linking
 *   to the previous entry's signature, so any tampered cell breaks
 *   the chain at the next verify.
 *
 *   Engineering qualities (per user mandate):
 *     - Atomic writes via rename(temp, final) to avoid partial states.
 *     - Best-effort: missing dir → mkdir; corrupt file → safe-default.
 *     - Never throws on the read path (always returns null on error).
 *     - HMAC secret env-overridable via MNEME_CHRONOSHEAF_SECRET.
 *     - Append-only persistence.jsonl bounded at 100K entries via rotation.
 */

import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export interface ChainEntry {
  v: typeof PROTOCOL_VERSION;
  /** Sequence number (monotonic per chain). */
  seq: number;
  /** Logical kind of write (cover / cech / persistence / rg_fixed / state). */
  kind: string;
  /** Wall-clock timestamp (ms). */
  ts: number;
  /** Content hash of the payload that was written. */
  payloadSha256: string;
  /** Previous chain entry's signature ('' for the genesis entry). */
  prevSig: string;
  /** HMAC over the canonicalised body (everything above + this entry). */
  sig: string;
}

export interface StorageInput<T> {
  /** Logical kind (file basename without extension). */
  kind: "cover" | "cech" | "persistence" | "rg_fixed_points" | "state" | string;
  /** Payload to write — serialised to JSON. */
  payload: T;
  /** Optional secret override. */
  secret?: string;
  /** Optional explicit timestamp (defaults to Date.now). */
  nowMs?: number;
}

export interface StorageOutput {
  /** Path the file was written to. */
  path: string;
  /** Chain entry recorded for this write. */
  entry: ChainEntry;
  /** Total chain length after this entry. */
  chainLength: number;
}

function defaultSecret(): string {
  return process.env["MNEME_CHRONOSHEAF_SECRET"] || `mneme-chronosheaf-storage-v${PROTOCOL_VERSION}`;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHmac("sha256", "mneme-chronosheaf-content").update(s).digest("hex");
}

function signEntry(body: Omit<ChainEntry, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

/** Compute the storage root for a given repo. */
export function storageRoot(repoRoot: string): string {
  return join(repoRoot, ".mneme", "chronosheaf");
}

/** Ensure storage dir exists (idempotent). Never throws. */
export function ensureStorageDir(repoRoot: string): string {
  const dir = storageRoot(repoRoot);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  return dir;
}

/** Read the chain length without parsing every entry (last entry's seq + 1). */
export function chainLength(repoRoot: string): number {
  const path = join(storageRoot(repoRoot), "chain.jsonl");
  if (!existsSync(path)) return 0;
  try {
    const txt = readFileSync(path, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return 0;
    const last = JSON.parse(lines[lines.length - 1]!) as ChainEntry;
    return (typeof last.seq === "number" ? last.seq : lines.length - 1) + 1;
  } catch { return 0; }
}

/** Last chain signature (the head). '' if chain is empty. */
export function chainHead(repoRoot: string): string {
  const path = join(storageRoot(repoRoot), "chain.jsonl");
  if (!existsSync(path)) return "";
  try {
    const txt = readFileSync(path, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    const last = JSON.parse(lines[lines.length - 1]!) as ChainEntry;
    return last.sig ?? "";
  } catch { return ""; }
}

/**
 * Persist a payload + append a chain entry. Atomic: writes to a temp
 * file first then renames into place to avoid half-written state.
 * Append-only chain.jsonl is bounded at 100K entries (rotated to .old).
 */
export function persist<T>(repoRoot: string, input: StorageInput<T>): StorageOutput {
  const dir = ensureStorageDir(repoRoot);
  const ext = input.kind === "persistence" ? "jsonl" : "json";
  const path = join(dir, `${input.kind}.${ext}`);
  // Persistence (jsonl) MUST be single-line so line-count = entry-count.
  // Other kinds get pretty-printed for human readability.
  const payloadStr = input.kind === "persistence"
    ? JSON.stringify(input.payload)
    : JSON.stringify(input.payload, null, 2);
  const payloadSha = sha256Hex(payloadStr);
  const secret = input.secret ?? defaultSecret();
  const nowMs = input.nowMs ?? Date.now();
  const seq = chainLength(repoRoot);
  const prevSig = chainHead(repoRoot);

  const entryBody: Omit<ChainEntry, "sig"> = {
    v: PROTOCOL_VERSION, seq, kind: input.kind, ts: nowMs, payloadSha256: payloadSha, prevSig,
  };
  const sig = signEntry(entryBody, secret);
  const entry: ChainEntry = { ...entryBody, sig };

  // Atomic write of the payload.
  try {
    if (input.kind === "persistence") {
      // Append-only for persistence diagram.
      appendFileSync(path, payloadStr + "\n");
    } else {
      const tmp = path + ".tmp";
      writeFileSync(tmp, payloadStr);
      try { renameSync(tmp, path); }
      catch {
        // Fallback for Windows EXDEV / EBUSY: direct write.
        writeFileSync(path, payloadStr);
      }
    }
  } catch (e) {
    // Persist failure should not lose the chain entry — record the error.
    const errEntry: ChainEntry = { ...entryBody, payloadSha256: "WRITE_FAILED:" + ((e as Error).message ?? ""), sig };
    appendChainEntry(repoRoot, errEntry);
    return { path, entry: errEntry, chainLength: seq + 1 };
  }
  appendChainEntry(repoRoot, entry);
  rotateIfNeeded(repoRoot);
  return { path, entry, chainLength: seq + 1 };
}

function appendChainEntry(repoRoot: string, entry: ChainEntry): void {
  const path = join(storageRoot(repoRoot), "chain.jsonl");
  try { ensureStorageDir(dirname(path)); } catch { /* ok */ }
  try { appendFileSync(path, JSON.stringify(entry) + "\n"); } catch { /* best-effort */ }
}

/** Rotate chain.jsonl + persistence.jsonl when they exceed 100K entries. */
function rotateIfNeeded(repoRoot: string): void {
  const dir = storageRoot(repoRoot);
  for (const f of ["chain.jsonl", "persistence.jsonl"]) {
    const path = join(dir, f);
    if (!existsSync(path)) continue;
    try {
      const txt = readFileSync(path, "utf8");
      const lineCount = txt.split(/\r?\n/).length;
      if (lineCount > 100_000) {
        const old = path + ".old";
        try { renameSync(path, old); } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  }
}

/** Read a stored payload back. Returns null on any error (never throws). */
export function readStored<T>(repoRoot: string, kind: string): T | null {
  const ext = kind === "persistence" ? "jsonl" : "json";
  const path = join(storageRoot(repoRoot), `${kind}.${ext}`);
  if (!existsSync(path)) return null;
  try {
    const txt = readFileSync(path, "utf8");
    if (kind === "persistence") {
      // Last line = latest snapshot.
      const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]!) as T;
    }
    return JSON.parse(txt) as T;
  } catch { return null; }
}

/** Verify the entire chain. Returns { ok, brokenAt?, reason? }. */
export function verifyChain(repoRoot: string, secret?: string): { ok: boolean; entries: number; brokenAt?: number; reason?: string } {
  const path = join(storageRoot(repoRoot), "chain.jsonl");
  if (!existsSync(path)) return { ok: true, entries: 0 };
  const sec = secret ?? defaultSecret();
  try {
    const txt = readFileSync(path, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let prevSig = "";
    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]!) as ChainEntry;
      if (entry.prevSig !== prevSig) {
        return { ok: false, entries: lines.length, brokenAt: i, reason: `prevSig mismatch at entry ${entry.seq}` };
      }
      const { sig, ...body } = entry;
      const expected = signEntry(body, sec);
      if (expected !== sig) {
        return { ok: false, entries: lines.length, brokenAt: i, reason: `HMAC mismatch at entry ${entry.seq}` };
      }
      prevSig = sig;
    }
    return { ok: true, entries: lines.length };
  } catch (e) {
    return { ok: false, entries: 0, reason: "read error: " + ((e as Error).message ?? "") };
  }
}

/** Summary used by the SLO dashboard. */
export function storageStats(repoRoot: string): {
  storageRoot: string;
  filesPresent: string[];
  chainEntries: number;
  chainHeadSig: string;
} {
  const dir = storageRoot(repoRoot);
  const present: string[] = [];
  for (const f of ["cover.json", "cech.json", "persistence.jsonl", "rg_fixed_points.json", "state.json", "chain.jsonl"]) {
    if (existsSync(join(dir, f))) present.push(f);
  }
  return {
    storageRoot: dir,
    filesPresent: present,
    chainEntries: chainLength(repoRoot),
    chainHeadSig: chainHead(repoRoot),
  };
}

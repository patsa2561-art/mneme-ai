/**
 * Replay Traces (v1.18.0 — black sheep #7)
 *
 * Every MCP tool call is recorded as one HMAC-chained line in
 * `.mneme/replay.jsonl`. Each entry's `prevHash` references the previous
 * line, so any tampering breaks the chain at exactly one point — Merkle
 * trail without a tree.
 *
 *   • mneme.replay.dump       — return the whole session trace as JSON
 *   • mneme.replay.fingerprint — return the Merkle root + chain integrity
 *
 * Use cases: SOC2 / EU AI Act audit evidence, deterministic-session proofs,
 * post-mortem reconstruction. The fingerprint is what you publish; the
 * dump is what you'd hand an auditor.
 *
 * The recorder lives in this file but is invoked from index.ts on every
 * call. Recording is best-effort — any I/O error is swallowed so a
 * corrupted disk can never block tool dispatch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { MnemeTool } from "./_types.js";

const REPLAY_DIR = ".mneme";
const REPLAY_FILE = "replay.jsonl";
const SECRET_FILE = "replay-secret.bin";

/** v1.42.2 (#19 fix) — rotate the replay file at 256 KB to prevent
 *  unbounded growth on long-running sessions. Same threshold the inbox,
 *  pheromone, and contracts modules use, for consistency. The HMAC
 *  chain is preserved across rotations because readLastHash falls back
 *  to the most recent rotated file when the active file is empty. */
const REPLAY_ROTATION_BYTES = 256 * 1024;

interface ReplayEntry {
  /** ISO-8601 timestamp. */
  ts: string;
  /** Tool name invoked. */
  tool: string;
  /** SHA-256 of the JSON-stringified arguments (full args may contain user data). */
  argHash: string;
  /** SHA-256 of the JSON-stringified response (full response may be huge). */
  responseHash: string;
  /** Verdict if the tool returned one (PASS/WARN/FAIL/etc.) — convenience field. */
  verdict?: string;
  /** Hash of the previous line + this line's payload — chain link. */
  prevHash: string;
  /** This entry's hash (HMAC of payload). Becomes prevHash for the next entry. */
  hash: string;
}

function ensureSecret(repoRoot: string): Buffer {
  const dir = join(repoRoot, REPLAY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, SECRET_FILE);
  if (existsSync(path)) return readFileSync(path);
  const buf = randomBytes(32);
  writeFileSync(path, buf, { mode: 0o600 });
  return buf;
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function hmacSha(secret: Buffer, payload: string): string {
  // HMAC-SHA-256, returned as 32-char hex prefix.
  const h = createHash("sha256");
  h.update(secret);
  h.update("|");
  h.update(payload);
  return h.digest("hex").slice(0, 32);
}

function readLastHashFromFile(p: string): string | null {
  if (!existsSync(p)) return null;
  try {
    const txt = readFileSync(p, "utf8").trimEnd();
    if (!txt) return null;
    const lines = txt.split("\n");
    const last = lines[lines.length - 1];
    if (!last) return null;
    const e = JSON.parse(last) as ReplayEntry;
    return e.hash;
  } catch {
    return null;
  }
}

function readLastHash(repoRoot: string): string {
  // First try the active replay file.
  const fromActive = readLastHashFromFile(join(repoRoot, REPLAY_DIR, REPLAY_FILE));
  if (fromActive) return fromActive;
  // v1.42.2 (#19 fix) — chain spans rotations. If the active file is
  // empty (just rotated, or fresh), fall back to the newest rotated
  // file so the next entry's prevHash continues the chain.
  try {
    const dir = join(repoRoot, REPLAY_DIR);
    if (!existsSync(dir)) return "GENESIS";
    const rotated = readdirSync(dir).filter((f) => f.startsWith(REPLAY_FILE + ".rotated-")).sort();
    if (rotated.length === 0) return "GENESIS";
    const fromRotated = readLastHashFromFile(join(dir, rotated[rotated.length - 1]!));
    return fromRotated ?? "GENESIS";
  } catch {
    return "GENESIS";
  }
}

function maybeRotateReplay(repoRoot: string): void {
  try {
    const path = join(repoRoot, REPLAY_DIR, REPLAY_FILE);
    if (!existsSync(path)) return;
    if (statSync(path).size < REPLAY_ROTATION_BYTES) return;
    renameSync(path, path + ".rotated-" + Date.now());
  } catch {
    // Best-effort rotation. If rename fails (Windows file lock, etc.),
    // the file simply keeps growing this turn; next call retries.
  }
}

/** Append a single tool-call record. Best-effort — never throws. */
export function recordReplay(
  repoRoot: string,
  tool: string,
  args: unknown,
  response: unknown,
): void {
  try {
    const secret = ensureSecret(repoRoot);
    const argHash = shortHash(JSON.stringify(args ?? {}));
    const responseHash = shortHash(JSON.stringify(response ?? {}));
    const verdict = extractVerdict(response);
    const prevHash = readLastHash(repoRoot);
    const ts = new Date().toISOString();
    const payload = `${ts}|${tool}|${argHash}|${responseHash}|${verdict ?? ""}|${prevHash}`;
    const hash = hmacSha(secret, payload);
    const entry: ReplayEntry = { ts, tool, argHash, responseHash, prevHash, hash };
    if (verdict) entry.verdict = verdict;
    appendFileSync(join(repoRoot, REPLAY_DIR, REPLAY_FILE), JSON.stringify(entry) + "\n", "utf8");
    // v1.42.2 (#19 fix) — rotate after append so an oversized file gets
    // archived before the NEXT call grows it further. Cheap stat() check
    // gates the actual rename. Best-effort.
    maybeRotateReplay(repoRoot);
  } catch {
    // best-effort — never block dispatch
  }
}

function extractVerdict(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as { data?: unknown };
  if (r.data && typeof r.data === "object") {
    const d = r.data as { verdict?: string };
    if (typeof d.verdict === "string") return d.verdict;
  }
  return undefined;
}

export interface ReplayChainStatus {
  total: number;
  intact: boolean;
  brokenAt?: number;
  /** Merkle root = HMAC(secret, lastHash). Stable identifier for the trace. */
  root: string;
}

export function verifyChain(repoRoot: string): ReplayChainStatus {
  const path = join(repoRoot, REPLAY_DIR, REPLAY_FILE);
  if (!existsSync(path)) return { total: 0, intact: true, root: "EMPTY" };
  const txt = readFileSync(path, "utf8").trimEnd();
  if (!txt) return { total: 0, intact: true, root: "EMPTY" };
  const secret = ensureSecret(repoRoot);
  const lines = txt.split("\n").filter(Boolean);
  let prev = "GENESIS";
  for (let i = 0; i < lines.length; i++) {
    let entry: ReplayEntry;
    try {
      entry = JSON.parse(lines[i]!) as ReplayEntry;
    } catch {
      return { total: lines.length, intact: false, brokenAt: i, root: "INVALID" };
    }
    if (entry.prevHash !== prev) {
      return { total: lines.length, intact: false, brokenAt: i, root: "BROKEN" };
    }
    const expected = hmacSha(
      secret,
      `${entry.ts}|${entry.tool}|${entry.argHash}|${entry.responseHash}|${entry.verdict ?? ""}|${entry.prevHash}`,
    );
    if (expected !== entry.hash) {
      return { total: lines.length, intact: false, brokenAt: i, root: "TAMPERED" };
    }
    prev = entry.hash;
  }
  // Merkle root = HMAC of the final hash (so root depends on all entries).
  const root = hmacSha(secret, prev);
  return { total: lines.length, intact: true, root };
}

export function readReplay(repoRoot: string, limit = 1000): ReplayEntry[] {
  const path = join(repoRoot, REPLAY_DIR, REPLAY_FILE);
  if (!existsSync(path)) return [];
  const txt = readFileSync(path, "utf8").trimEnd();
  if (!txt) return [];
  const lines = txt.split("\n").filter(Boolean);
  const slice = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
  return slice
    .map((l) => {
      try {
        return JSON.parse(l) as ReplayEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ReplayEntry => e !== null);
}

export const replayDumpTool: MnemeTool = {
  name: "mneme.replay.dump",
  category: "meta",
  description:
    "Return the HMAC-chained replay log of every MCP tool call this session " +
    "(and earlier sessions in the same repo). Each entry: timestamp, tool name, " +
    "argument-hash, response-hash, verdict (if present), and the chain link. " +
    "Use WHEN you need a complete audit trail of what the AI did — for SOC2 / " +
    "EU AI Act compliance, postmortem reconstruction, or deterministic-session " +
    "proofs. Pair with mneme.replay.fingerprint for a tamper-evident root hash.",
  whenToUse:
    "You need the complete audit trail of every tool call in this repo (or session) — for compliance / postmortem / reproducibility.",
  triggers: ["dump replay log", "audit trail", "session trace", "SOC2 evidence"],
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max entries to return (most-recent N). Default 1000. 0 = no cap.",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      returned: { type: "number" },
      entries: { type: "array", items: { type: "object" } },
    },
  },
  examples: [
    {
      userQuery: "Give me the audit trail of every Mneme call from this AI session",
      args: { limit: 1000 },
      expectedOutput: "Returns up to 1000 most-recent ReplayEntry objects. Each has ts/tool/argHash/responseHash/prevHash/hash and optional verdict.",
    },
  ],
  pitfalls: [
    "The log is INDEFINITE — it grows across sessions. Rotate manually if you don't want cross-session traces.",
    "Hashes are short (16-char prefix) for readability — a determined attacker COULD find collisions; this is audit-grade, not crypto-grade integrity.",
    "Recording is best-effort: a disk-full error swallows the entry silently rather than blocking dispatch.",
  ],
  composeWith: ["mneme.replay.fingerprint", "mneme.audit.ledger", "mneme.audit.report"],
  handler: async (rt, args) => {
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 1000;
    const entries = readReplay(rt.meta.rootPath, limit);
    return {
      data: {
        total: entries.length,
        returned: entries.length,
        entries,
      },
      wisdom:
        entries.length === 0
          ? "Replay log is empty — either no tool calls have happened in this repo yet, or the log was never created."
          : `Returned ${entries.length} chain-linked entries. Verify integrity via mneme.replay.fingerprint.`,
      followUp: ["mneme.replay.fingerprint"],
      confidence: { level: "high" },
    };
  },
};

export const replayFingerprintTool: MnemeTool = {
  name: "mneme.replay.fingerprint",
  category: "meta",
  description:
    "Return the tamper-evident root hash of the replay log + chain integrity " +
    "status. Each entry in the log links to the previous via HMAC, so any " +
    "tampering breaks the chain at exactly one point. The root is a stable " +
    "identifier you can publish to prove this AI session was deterministic + " +
    "untouched. Use WHEN you want to attest to session integrity (e.g., embed " +
    "the root in a release note, or compare two replay logs to prove they ran " +
    "the same sequence).",
  whenToUse:
    "You need a single tamper-evident hash that summarizes the entire MCP-call history of this repo — publishable proof of session integrity.",
  triggers: ["replay fingerprint", "session merkle root", "integrity check"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      intact: { type: "boolean" },
      brokenAt: { type: "number", description: "Line index where chain broke (only set if intact=false)." },
      root: { type: "string", description: "Merkle root — stable identifier for this trace." },
    },
  },
  examples: [
    {
      userQuery: "Is the audit trail intact?",
      expectedOutput:
        "Returns { total, intact: true, root: '<32-hex>' } when chain verifies. If tampered: intact=false, brokenAt set, root = 'TAMPERED' / 'BROKEN' / 'INVALID'.",
    },
  ],
  pitfalls: [
    "Verifies the LOCAL log only — there's no global anchor (yet). For external attestation, post the root to git via a tagged commit.",
    "If .mneme/replay-secret.bin is regenerated, ALL prior chain links become unverifiable. Treat the secret like a key.",
  ],
  composeWith: ["mneme.replay.dump", "mneme.audit.ledger"],
  handler: async (rt) => {
    const status = verifyChain(rt.meta.rootPath);
    return {
      data: status,
      wisdom: status.intact
        ? `Chain intact — ${status.total} entr${status.total === 1 ? "y" : "ies"}. Root: ${status.root}.`
        : `CHAIN BROKEN at entry ${status.brokenAt} — replay log has been tampered with or corrupted. Root: ${status.root}.`,
      confidence: { level: "high" },
      followUp: ["mneme.replay.dump"],
    };
  },
};

export const replayTools: MnemeTool[] = [replayDumpTool, replayFingerprintTool];

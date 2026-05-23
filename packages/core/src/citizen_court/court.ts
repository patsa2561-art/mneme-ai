/**
 * v2.33.0 — CONFESSIONAL court reveal + vote ledger.
 *
 * The 1-second reveal mechanic is the citizen-court UX:
 *   user accepts/rejects → 1s wait → 4 other vendors' answers appear →
 *   user votes which was most truthful → HMAC-signed verdict.
 *
 * Storage:
 *   .mneme/citizen_court/pending_reveals.jsonl   — reveals awaiting vote
 *   .mneme/citizen_court/verdicts.jsonl          — finalized HMAC-chained
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

import type {
  CourtVerdict, CourtRevealInput, CourtReveal, VoteInput,
} from "./types.js";

const HMAC_KEY = process.env["MNEME_CONFESSIONAL_KEY"] ?? "mneme-confessional-v1";
const CHAIN_SEED = "0".repeat(64);
let lastChainLink = CHAIN_SEED;
export function __resetConfessionalChainForTest(): void { lastChainLink = CHAIN_SEED; }

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function sha8(s: string): string { return sha(s).slice(0, 12); }
function hmacOf(prev: string, payload: string): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + payload).digest("hex");
}

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "citizen_court");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function pendingPath(repoRoot: string): string { return join(dirOf(repoRoot), "pending_reveals.jsonl"); }
function verdictPath(repoRoot: string): string { return join(dirOf(repoRoot), "verdicts.jsonl"); }

interface PendingReveal {
  id: string;
  reveal: CourtReveal;
  primaryVendor: string;
  promptHash: string;
  primaryResponseHash: string;
  primaryAction: "accepted" | "rejected";
  createdAt: string;
}

function readPending(repoRoot: string): PendingReveal[] {
  const p = pendingPath(repoRoot);
  if (!existsSync(p)) return [];
  const out: PendingReveal[] = [];
  try {
    for (const ln of readFileSync(p, "utf8").split("\n").filter(Boolean)) {
      try { out.push(JSON.parse(ln) as PendingReveal); } catch { /* skip */ }
    }
  } catch { /* best-effort */ }
  return out;
}

function writePending(repoRoot: string, rows: PendingReveal[]): void {
  writeFileSync(pendingPath(repoRoot), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/**
 * Stage 1 — RECORD the primary action + schedule the reveal.
 *
 * The "1-second" delay is honoured via a Promise but tests can pass
 * `delayMs: 0`. Caller MAY supply primary + reveal response texts;
 * we hash them locally so the verdict ledger never holds raw text.
 */
export async function recordRevealAndWait(repoRoot: string, input: CourtRevealInput): Promise<{ id: string; reveal: CourtReveal }> {
  const delayMs = input.delayMs ?? 1000;
  if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs));
  const reveals = input.revealVendors.map((vendor) => {
    const text = input.revealResponses?.[vendor] ?? "";
    return { vendor, responseHash: sha(text), revealDelayMs: delayMs };
  });
  const previews = input.revealVendors.map((vendor) => ({
    vendor,
    preview: (input.revealResponses?.[vendor] ?? "").slice(0, 200),
  }));
  const revealedAt = new Date().toISOString();
  const reveal: CourtReveal = { revealedAt, reveals, previews };
  // Stable id from canonical inputs so the same court session is idempotent.
  const id = "rv-" + sha8(canon({
    primaryVendor: input.primaryVendor,
    promptHash: input.promptHash,
    primaryResponseHash: input.primaryResponseHash,
    primaryAction: input.primaryAction,
    revealedAt,
  }));
  const row: PendingReveal = {
    id, reveal,
    primaryVendor: input.primaryVendor,
    promptHash: input.promptHash,
    primaryResponseHash: input.primaryResponseHash,
    primaryAction: input.primaryAction,
    createdAt: revealedAt,
  };
  try { appendFileSync(pendingPath(repoRoot), JSON.stringify(row) + "\n"); } catch { /* best-effort */ }
  return { id, reveal };
}

/**
 * Stage 2 — VOTE on the reveal. Finalizes a CONFESSIONAL verdict +
 * HMAC-chains it + removes the pending row.
 */
export function vote(repoRoot: string, input: VoteInput): CourtVerdict {
  const pending = readPending(repoRoot);
  const idx = pending.findIndex((p) => p.id === input.revealId);
  if (idx < 0) throw new Error(`no pending reveal with id ${input.revealId}`);
  const pend = pending[idx]!;
  // Validate vote target
  const validTargets = new Set<string>([pend.primaryVendor, ...pend.reveal.reveals.map((r) => r.vendor), "ABSTAIN"]);
  if (!validTargets.has(input.votedMostTruthful)) {
    throw new Error(`vote target "${input.votedMostTruthful}" not in court (valid: ${Array.from(validTargets).join(", ")})`);
  }

  const at = new Date().toISOString();
  const verdictBody: Omit<CourtVerdict, "id" | "hmac" | "seq" | "bodyDigest"> = {
    primaryVendor: pend.primaryVendor,
    at,
    promptHash: pend.promptHash,
    primaryResponseHash: pend.primaryResponseHash,
    primaryAction: pend.primaryAction,
    reveals: pend.reveal.reveals,
    votedMostTruthful: input.votedMostTruthful,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    dpEpsilon: input.dpEpsilon ?? 0,
  };
  const id = "v-" + sha8(canon(verdictBody));
  const fullBody = { id, ...verdictBody };
  const bodyDigest = sha(canon(fullBody));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  const verdict: CourtVerdict = {
    ...fullBody,
    hmac: lastChainLink,
    seq: parseInt(lastChainLink.slice(0, 8), 16),
    bodyDigest,
  };

  // Persist verdict + remove pending row.
  try { appendFileSync(verdictPath(repoRoot), JSON.stringify(verdict) + "\n"); } catch { /* best-effort */ }
  pending.splice(idx, 1);
  writePending(repoRoot, pending);
  return verdict;
}

export function listVerdicts(repoRoot: string, limit = 1000): CourtVerdict[] {
  const p = verdictPath(repoRoot);
  if (!existsSync(p)) return [];
  const out: CourtVerdict[] = [];
  try {
    for (const ln of readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-limit)) {
      try { out.push(JSON.parse(ln) as CourtVerdict); } catch { /* skip */ }
    }
  } catch { /* best-effort */ }
  return out;
}

export function listPending(repoRoot: string): PendingReveal[] {
  return readPending(repoRoot);
}

export function verifyVerdict(v: CourtVerdict, prev: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = v;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prev, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

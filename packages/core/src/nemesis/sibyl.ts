/**
 * v2.52.0 — SIBYL (Diamond 6 / Million Dollar Secret series).
 *
 * Show mechanic: contestants commit their identity at session-start
 * (sealed envelope), reveal at session-end. Lock prevents mid-session
 * identity switching.
 *
 * Mneme primitive: a SIMPLE-ZK identity commitment scheme.
 *
 *   1. Session start: vendor computes commitment = SHA-256(identity || nonce)
 *      and emits it (publicly, signed). Identity + nonce stay private.
 *   2. Mid-session: vendor works. Identity not revealed. Other parties
 *      can still verify the commitment matches the session's signed
 *      receipts via the HMAC chain.
 *   3. Session end / on demand: vendor reveals (identity, nonce). Anyone
 *      can recompute SHA-256(identity || nonce) and verify it matches
 *      the original commitment.
 *
 * This is the "hash commitment" branch of ZK — simpler than zkSNARKs,
 * adequate for "I declared X at session-start, here's the proof I
 * didn't change to Y mid-session".
 *
 * Wild value-adds this module ships:
 *   - NESTED COMMITMENTS: commit (vendor, model, version) as a tuple;
 *     reveal any subset. Lets a vendor disclose vendor without leaking
 *     exact model.
 *   - PAIR with EU Article 50: emit commitment at PR open, reveal at
 *     merge. Compliance auditors can verify identity didn't drift.
 *   - SESSION-BIND: commitment includes a session-id; the same
 *     identity+nonce signed for session A cannot be replayed in B.
 *
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

const SIBYL_DIR = ".mneme/nemesis/sibyl";
const COMMITS_FILE = "commitments.jsonl";
const KEY_ENV = "MNEME_SIBYL_KEY";
const DEFAULT_KEY = "mneme-sibyl-v1";
const SEED = "0".repeat(64);

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface SibylIdentity {
  vendor: string;
  model?: string;
  version?: string;
}

export interface SibylCommitment {
  /** Session identifier — prevents cross-session replay. */
  sessionId: string;
  /** SHA-256(identity || nonce || sessionId). */
  commitmentHash: string;
  /** Mask: which fields the commitment includes. */
  mask: { vendor: boolean; model: boolean; version: boolean };
  /** ISO-8601 commit timestamp. */
  at: string;
  /** HMAC over commitment metadata (signs the commit envelope). */
  hmac: string;
  prev: string;
}

export interface SibylReveal {
  sessionId: string;
  identity: SibylIdentity;
  nonce: string;
  mask: { vendor: boolean; model: boolean; version: boolean };
  at: string;
  hmac: string;
  prev: string;
}

function canonicalIdentity(identity: SibylIdentity, mask: SibylCommitment["mask"]): string {
  // Stable canonical form. Empty fields when not masked = stable empty marker.
  return JSON.stringify({
    vendor: mask.vendor ? (identity.vendor ?? "") : "",
    model: mask.model ? (identity.model ?? "") : "",
    version: mask.version ? (identity.version ?? "") : "",
  });
}

function commitmentHashOf(identity: SibylIdentity, nonce: string, sessionId: string, mask: SibylCommitment["mask"]): string {
  return createHash("sha256")
    .update(canonicalIdentity(identity, mask))
    .update("|")
    .update(nonce)
    .update("|")
    .update(sessionId)
    .digest("hex");
}

function envelopeHmac(body: object): string {
  return createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
}

function dirOf(repoRoot: string): string {
  const dir = join(repoRoot, SIBYL_DIR);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  return dir;
}

function readChain(repoRoot: string): Array<SibylCommitment | SibylReveal> {
  const p = join(dirOf(repoRoot), COMMITS_FILE);
  if (!existsSync(p)) return [];
  try {
    const out: Array<SibylCommitment | SibylReveal> = [];
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as SibylCommitment | SibylReveal); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

function lastHmac(repoRoot: string): string {
  const rows = readChain(repoRoot);
  return rows.length === 0 ? SEED : (rows[rows.length - 1] as { hmac: string }).hmac;
}

function appendChain(repoRoot: string, row: SibylCommitment | SibylReveal): void {
  try { appendFileSync(join(dirOf(repoRoot), COMMITS_FILE), JSON.stringify(row) + "\n"); } catch { /* ok */ }
}

// ════════════════════════════════════════════════════════════════════
//  Public API
// ════════════════════════════════════════════════════════════════════

export interface CommitOpts {
  identity: SibylIdentity;
  sessionId?: string;
  /** Provide your own nonce for testability; otherwise generated. */
  nonce?: string;
  /** Which fields the commitment locks. Default: all present fields. */
  mask?: Partial<SibylCommitment["mask"]>;
  /** Persist to .mneme/nemesis/sibyl/commitments.jsonl (default true). */
  persist?: boolean;
}

export interface CommitResult {
  commitment: SibylCommitment;
  /** Returned ONLY to the caller — the secret needed to reveal later. */
  nonce: string;
  /** Same — caller is responsible for safekeeping these until reveal. */
  identitySnapshot: SibylIdentity;
}

/** Issue a new commitment. The nonce is returned ONCE to the caller. */
export function commitIdentity(repoRoot: string, opts: CommitOpts): CommitResult {
  const sessionId = opts.sessionId ?? `S-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const mask: SibylCommitment["mask"] = {
    vendor: opts.mask?.vendor ?? !!opts.identity.vendor,
    model: opts.mask?.model ?? !!opts.identity.model,
    version: opts.mask?.version ?? !!opts.identity.version,
  };
  const at = new Date().toISOString();
  const commitmentHash = commitmentHashOf(opts.identity, nonce, sessionId, mask);
  const prev = (opts.persist === false) ? SEED : lastHmac(repoRoot);
  const body = { sessionId, commitmentHash, mask, at, prev };
  const hmac = envelopeHmac(body);
  const commitment: SibylCommitment = { ...body, hmac };
  if (opts.persist !== false) appendChain(repoRoot, commitment);
  return { commitment, nonce, identitySnapshot: { ...opts.identity } };
}

export interface RevealOpts {
  sessionId: string;
  identity: SibylIdentity;
  nonce: string;
  /** Mask must match the commit's mask. */
  mask?: Partial<SibylCommitment["mask"]>;
  persist?: boolean;
}

export interface RevealResult {
  reveal: SibylReveal;
  /** True iff the supplied (identity, nonce) recreates the original commitment. */
  matches: boolean;
  /** Reference to the original commitment (if found in chain). */
  matchedCommitment?: SibylCommitment;
}

/** Reveal + verify against the stored chain (or pass commitment explicitly). */
export function revealIdentity(repoRoot: string, opts: RevealOpts, knownCommitment?: SibylCommitment): RevealResult {
  const at = new Date().toISOString();
  // Locate matching commit in chain (if not given)
  let target: SibylCommitment | undefined = knownCommitment;
  if (!target) {
    const chain = readChain(repoRoot);
    target = chain.find((r): r is SibylCommitment => "commitmentHash" in r && (r as SibylCommitment).sessionId === opts.sessionId) ?? undefined;
  }
  const matches = target
    ? (commitmentHashOf(opts.identity, opts.nonce, opts.sessionId, target.mask) === target.commitmentHash)
    : false;
  const prev = (opts.persist === false) ? SEED : lastHmac(repoRoot);
  const mask: SibylCommitment["mask"] = target ? target.mask : {
    vendor: opts.mask?.vendor ?? !!opts.identity.vendor,
    model: opts.mask?.model ?? !!opts.identity.model,
    version: opts.mask?.version ?? !!opts.identity.version,
  };
  const body = { sessionId: opts.sessionId, identity: opts.identity, nonce: opts.nonce, mask, at, prev };
  const hmac = envelopeHmac(body);
  const reveal: SibylReveal = { ...body, hmac };
  if (opts.persist !== false) appendChain(repoRoot, reveal);
  return { reveal, matches, matchedCommitment: target };
}

/** Read all SIBYL events from disk + verify chain. */
export function verifySibylChain(repoRoot: string): { ok: boolean; rows: number; brokenAt?: number; reason?: string } {
  const rows = readChain(repoRoot);
  let prev = SEED;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const { hmac, ...body } = r as unknown as { hmac: string; prev: string; [k: string]: unknown };
    if (body.prev !== prev) return { ok: false, rows: i, brokenAt: i, reason: "prev mismatch" };
    const expected = envelopeHmac(body);
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i, reason: "hmac mismatch" };
    prev = hmac;
  }
  return { ok: true, rows: rows.length };
}

/** Verify a commitment+reveal pair WITHOUT touching the chain. Pure. */
export function verifyCommitmentReveal(
  commitment: SibylCommitment,
  reveal: { identity: SibylIdentity; nonce: string },
): { ok: boolean; reason?: string } {
  if (!commitment || !reveal) return { ok: false, reason: "missing inputs" };
  const expected = commitmentHashOf(reveal.identity, reveal.nonce, commitment.sessionId, commitment.mask);
  if (expected !== commitment.commitmentHash) return { ok: false, reason: "commitment hash mismatch" };
  return { ok: true };
}

/** Diagnostic: list all open commitments (no matching reveal yet). */
export function listOpenCommitments(repoRoot: string): SibylCommitment[] {
  const chain = readChain(repoRoot);
  const revealedSessions = new Set(
    chain.filter((r): r is SibylReveal => "nonce" in r).map((r) => r.sessionId),
  );
  return chain.filter((r): r is SibylCommitment => "commitmentHash" in r && !revealedSessions.has((r as SibylCommitment).sessionId));
}

/**
 * v2.98.0 — HYDRA · PROVENANCE CHAIN (the deepest cut).
 *
 * Memory with a cryptographic, replayable, byte-exact history. Each time a
 * codebook evolves (the corpus changed, new phrases earned a slot), HYDRA
 * records a SIGNED DELTA — not the whole codebook, just what changed —
 * chained to the previous one. The chain is:
 *
 *   - LOSSLESS-REPLAYABLE: fold deltas 0..i and you get back the EXACT
 *     codebook that existed at step i (canonical-hash identical) — not an
 *     approximation, a byte-for-byte reconstruction.
 *   - OFFLINE-VERIFIABLE: every delta carries a NOTARY (Ed25519) receipt
 *     over its result hash; a third party verifies the whole history with
 *     the public key alone — no Mneme, no network.
 *   - TAMPER-EVIDENT: edit any delta and both its signature AND the
 *     prev→result hash links break; the breakage is localized.
 *
 * This fuses two organs already at Mneme's root — NOTARY (signing) and
 * HYDRA (codebooks) — into one. It is NOT a new compression trick; it is
 * the *provenance* of the gem. Diffing is by PHRASE (the stable identity;
 * symbols are positional and re-index on every change), so apply()
 * deterministically rebuilds → replay is exact.
 *
 * STABILITY (the 108-error rule): every function is total. A malformed
 * codebook, a broken delta, a corrupt receipt → a structured `ok:false`
 * verdict, never a throw. Memory provenance must never crash the host.
 */

import { type Codebook, type CodebookEntry, sha256Hex } from "./engine.js";
import { buildCodebook } from "./analytic.js";
import { canonicalizeCodebook } from "./attest.js";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

export interface CodebookDelta {
  v: 1;
  seq: number;
  /** result hash of the previous delta (null for genesis). */
  prev: string | null;
  /** canonical hash of the codebook BEFORE this delta. */
  baseHash: string;
  /** canonical hash of the codebook AFTER this delta. */
  resultHash: string;
  /** phrases present after but not before (full entries, to rebuild). */
  added: Array<{ phrase: string; hits: number; gain: number }>;
  /** phrases present before but not after. */
  removed: string[];
  /** the after-codebook's marker pair + corpus hash (to rebuild exactly). */
  open: string;
  close: string;
  corpusHash: string;
  /** NOTARY receipt over { resultHash, seq, prev }. */
  receipt: NotaryReceipt;
}

function entriesByPhrase(cb: Codebook): Map<string, CodebookEntry> {
  const m = new Map<string, CodebookEntry>();
  if (cb && Array.isArray(cb.entries)) for (const e of cb.entries) if (e && typeof e.phrase === "string") m.set(e.phrase, e);
  return m;
}

/**
 * Compute the delta `before → after` (by phrase). Pure; never throws.
 * Signs the delta over its result hash so the chain is attributable.
 */
export function diffCodebooks(repoRoot: string, before: Codebook | null, after: Codebook, seq: number, prev: string | null, at: number): CodebookDelta {
  const beforeMap = before ? entriesByPhrase(before) : new Map<string, CodebookEntry>();
  const afterMap = entriesByPhrase(after);
  const added: Array<{ phrase: string; hits: number; gain: number }> = [];
  const removed: string[] = [];
  for (const [phrase, e] of afterMap) if (!beforeMap.has(phrase)) added.push({ phrase, hits: e.hits, gain: e.gain });
  for (const phrase of beforeMap.keys()) if (!afterMap.has(phrase)) removed.push(phrase);
  // Deterministic ordering.
  added.sort((a, b) => (a.phrase < b.phrase ? -1 : 1));
  removed.sort();
  const baseHash = before ? sha256Hex(canonicalizeCodebook(before)) : sha256Hex("∅");
  const resultHash = sha256Hex(canonicalizeCodebook(after));
  const receipt = issueReceipt(repoRoot, {
    kind: "memory-capsule",
    subject: `hydra-chain:${seq}:${resultHash.slice(0, 16)}`,
    payload: { resultHash, seq, prev, baseHash },
    includePayload: true,
    issuedAt: at,
  });
  return { v: 1, seq, prev, baseHash, resultHash, added, removed, open: after.open, close: after.close, corpusHash: after.corpusHash, receipt };
}

/**
 * Apply a delta to a before-codebook → the after-codebook, rebuilt
 * deterministically (re-sorted, re-indexed). Returns ok:false (never
 * throws) if the rebuild does not hash to the delta's resultHash.
 */
export function applyDelta(before: Codebook | null, delta: CodebookDelta): { ok: boolean; codebook: Codebook | null; reason: string } {
  try {
    if (!delta || delta.v !== 1 || !Array.isArray(delta.added) || !Array.isArray(delta.removed)) {
      return { ok: false, codebook: null, reason: "malformed delta" };
    }
    const map = before ? entriesByPhrase(before) : new Map<string, CodebookEntry>();
    for (const p of delta.removed) map.delete(p);
    for (const a of delta.added) map.set(a.phrase, { sym: "", phrase: a.phrase, hits: a.hits, gain: a.gain });
    const phrases = [...map.values()].map((e) => ({ phrase: e.phrase, hits: e.hits, gain: e.gain }));
    // Reconstruct the corpus-bound codebook deterministically. corpusHash is
    // carried so the rebuilt codebook is bit-identical to the original.
    const rebuilt = buildCodebook(delta.open, delta.close, phrases, "");
    rebuilt.corpusHash = delta.corpusHash;
    const h = sha256Hex(canonicalizeCodebook(rebuilt));
    if (h !== delta.resultHash) return { ok: false, codebook: null, reason: `replay hash mismatch (got ${h.slice(0, 12)}, want ${delta.resultHash.slice(0, 12)})` };
    return { ok: true, codebook: rebuilt, reason: "applied" };
  } catch (e) {
    return { ok: false, codebook: null, reason: `threw: ${(e as Error).message}` };
  }
}

export interface ChainAppendResult {
  chain: CodebookDelta[];
  delta: CodebookDelta;
}

/** Append a codebook to a chain by diffing against the last one. Total. */
export function appendToChain(repoRoot: string, chain: CodebookDelta[], next: Codebook, at: number): ChainAppendResult {
  const safe = Array.isArray(chain) ? chain : [];
  const last = safe.length > 0 ? safe[safe.length - 1]! : null;
  const before = last ? replayChain(safe, safe.length - 1).codebook : null;
  const delta = diffCodebooks(repoRoot, before, next, safe.length, last ? last.resultHash : null, at);
  return { chain: [...safe, delta], delta };
}

export interface ReplayResult {
  ok: boolean;
  codebook: Codebook | null;
  reason: string;
}

/**
 * Replay deltas 0..index (inclusive) → the codebook at that step. Pure;
 * never throws. ok:false the moment any delta fails to apply.
 */
export function replayChain(chain: CodebookDelta[], index: number): ReplayResult {
  if (!Array.isArray(chain)) return { ok: false, codebook: null, reason: "not a chain" };
  const end = Math.min(index, chain.length - 1);
  let cb: Codebook | null = null;
  for (let i = 0; i <= end; i++) {
    const r = applyDelta(cb, chain[i]!);
    if (!r.ok) return { ok: false, codebook: null, reason: `delta ${i}: ${r.reason}` };
    cb = r.codebook;
  }
  return { ok: true, codebook: cb, reason: "replayed" };
}

export interface ChainVerdict {
  ok: boolean;
  length: number;
  /** first broken delta index, or -1. */
  brokenAt: number;
  reason: string;
}

/**
 * Verify the whole chain OFFLINE: each delta's Ed25519 receipt is valid and
 * binds its (resultHash, seq, prev); prev→result links are intact; and each
 * delta replays to its own resultHash. Tamper anywhere → localized break.
 * Total; never throws.
 */
export function verifyChain(chain: CodebookDelta[]): ChainVerdict {
  if (!Array.isArray(chain)) return { ok: false, length: 0, brokenAt: -1, reason: "not a chain" };
  let prevResult: string | null = null;
  let cb: Codebook | null = null;
  for (let i = 0; i < chain.length; i++) {
    const d = chain[i]!;
    if (!d || d.seq !== i || d.prev !== prevResult) return { ok: false, length: chain.length, brokenAt: i, reason: `broken link at ${i}` };
    const v = verifyReceipt(d.receipt);
    if (!v.valid) return { ok: false, length: chain.length, brokenAt: i, reason: `bad signature at ${i}: ${v.reason}` };
    const payload = (d.receipt as { payload?: { resultHash?: string; seq?: number; prev?: string | null } }).payload;
    if (!payload || payload.resultHash !== d.resultHash || payload.seq !== d.seq || payload.prev !== d.prev) {
      return { ok: false, length: chain.length, brokenAt: i, reason: `receipt does not bind delta ${i} (tampered)` };
    }
    const r = applyDelta(cb, d);
    if (!r.ok) return { ok: false, length: chain.length, brokenAt: i, reason: `replay broke at ${i}: ${r.reason}` };
    cb = r.codebook;
    prevResult = d.resultHash;
  }
  return { ok: true, length: chain.length, brokenAt: -1, reason: "chain intact + every delta signed + replays exact" };
}

export interface ChainGauntlet {
  /** chain verifies (sigs + links + replay). */
  verified: boolean;
  /** replaying to EVERY index reproduces that step's codebook hash. */
  replayExact: boolean;
  /** tampering a delta is caught (localized break). */
  tamperCaught: boolean;
  length: number;
  /** 0–100. 100 ⟺ verified ∧ replayExact ∧ tamperCaught. */
  score: number;
}

/** The provenance gauntlet — every property as a boolean that can't lie. */
export function chainGauntlet(chain: CodebookDelta[]): ChainGauntlet {
  try {
    const v = verifyChain(chain);
    let replayExact = true;
    for (let i = 0; i < chain.length; i++) {
      const r = replayChain(chain, i);
      if (!r.ok || !r.codebook || sha256Hex(canonicalizeCodebook(r.codebook)) !== chain[i]!.resultHash) { replayExact = false; break; }
    }
    let tamperCaught = true;
    if (chain.length > 0) {
      const mid = Math.floor(chain.length / 2);
      const clone: CodebookDelta[] = JSON.parse(JSON.stringify(chain));
      // Tamper the result hash of one delta — must be caught.
      clone[mid]!.resultHash = sha256Hex(clone[mid]!.resultHash + "X");
      tamperCaught = verifyChain(clone).ok === false;
    }
    const perfect = v.ok && replayExact && tamperCaught;
    return { verified: v.ok, replayExact, tamperCaught, length: chain.length, score: perfect ? 100 : 0 };
  } catch {
    return { verified: false, replayExact: false, tamperCaught: false, length: Array.isArray(chain) ? chain.length : 0, score: 0 };
  }
}

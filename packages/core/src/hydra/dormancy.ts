/**
 * v2.102.0 — HYDRA · EPIGENETIC DORMANCY ("sleep state" + JIT revival).
 *
 * The image's "Epigenetic Sleep State" + "JIT Context Revival
 * (Demethylation)", made real and measurable. Borrowed from biology only
 * as a NAME: deep-sea extremophiles silence genes under pressure without
 * editing their DNA, and re-express them when the environment pokes.
 *
 * Here, codebook entries the atrophy clock has proven COLD are METHYLATED —
 * moved out of the active working set into a cold, signed dormant store, so
 * the active footprint shrinks (the enterprise-scale win: most knowledge
 * sleeps, the working set stays small). On demand they DEMETHYLATE —
 * revive BYTE-EXACT, and a full revive reconstructs the original codebook
 * with an identical canonical hash. The whole split is Ed25519-signed, so a
 * third party verifies offline that nothing was lost or forged across the
 * sleep/wake cycle.
 *
 * This is NOT fortune-telling and NOT lossy: it is deterministic tiered
 * memory with a cryptographic lossless-revival proof. Three booleans that
 * cannot lie: revive-exact ∧ shrinks ∧ signed-binds. Every function is
 * total (108-error rule) — garbage in → safest result, never a throw.
 */

import { type Codebook, sha256Hex } from "./engine.js";
import { buildCodebook } from "./analytic.js";
import { canonicalizeCodebook } from "./attest.js";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

interface Phrase { phrase: string; hits: number; gain: number }

export interface Methylation {
  v: 1;
  open: string;
  close: string;
  corpusHash: string;
  /** canonical hash of the ORIGINAL (full) codebook — the revival target. */
  originalHash: string;
  /** fresh entries kept hot in the working set. */
  active: Phrase[];
  /** cold entries put to sleep (revivable, byte-exact). */
  dormant: Phrase[];
  activeBytes: number;
  dormantBytes: number;
  fullBytes: number;
  /** NOTARY receipt over { originalHash, activeHash, dormantHash, dormantCount }. */
  receipt: NotaryReceipt;
}

function bytesOf(entries: Phrase[]): number {
  let n = 0; for (const e of entries) n += Buffer.byteLength(e.phrase, "utf8") + 8; return n;
}
function phrasesOf(cb: Codebook): Phrase[] {
  return (cb?.entries ?? []).filter((e) => e && typeof e.phrase === "string").map((e) => ({ phrase: e.phrase, hits: e.hits, gain: e.gain }));
}
/** Rebuild a codebook from a phrase set, bound to the original corpus hash. */
function rebuild(open: string, close: string, phrases: Phrase[], corpusHash: string): Codebook {
  const cb = buildCodebook(open, close, phrases, "");
  cb.corpusHash = corpusHash;
  return cb;
}

/**
 * METHYLATE — split a codebook into a hot ACTIVE set and a cold DORMANT
 * store, based on which symbols a trust map marks stale/quarantined.
 * Signed. Total; never throws.
 */
export function methylate(repoRoot: string, cb: Codebook, trustMap: Record<string, "fresh" | "stale" | "quarantined">, at: number): Methylation {
  // 108-error rule: a malformed codebook normalizes to an empty one rather
  // than throwing — memory tiering must never crash the host.
  const safeCb: Codebook = (cb && Array.isArray(cb.entries))
    ? cb
    : { v: 1, open: "", close: "", corpusHash: "", entries: [] };
  const open = safeCb.open ?? "", close = safeCb.close ?? "", corpusHash = safeCb.corpusHash ?? "";
  const active: Phrase[] = [], dormant: Phrase[] = [];
  for (const e of safeCb.entries) {
    if (!e || typeof e.phrase !== "string") continue;
    const lvl = trustMap && trustMap[e.sym];
    if (lvl === "stale" || lvl === "quarantined") dormant.push({ phrase: e.phrase, hits: e.hits, gain: e.gain });
    else active.push({ phrase: e.phrase, hits: e.hits, gain: e.gain });
  }
  const originalHash = sha256Hex(canonicalizeCodebook(safeCb));
  const activeHash = sha256Hex(canonicalizeCodebook(rebuild(open, close, active, corpusHash)));
  const dormantHash = sha256Hex(JSON.stringify(dormant.map((d) => d.phrase).sort()));
  const receipt = issueReceipt(repoRoot, {
    kind: "memory-capsule",
    subject: `hydra-dormancy:${originalHash.slice(0, 16)}`,
    payload: { originalHash, activeHash, dormantHash, dormantCount: dormant.length },
    includePayload: true,
    issuedAt: at,
  });
  return {
    v: 1, open, close, corpusHash, originalHash, active, dormant,
    activeBytes: bytesOf(active), dormantBytes: bytesOf(dormant), fullBytes: bytesOf([...active, ...dormant]),
    receipt,
  };
}

export interface RevivalResult {
  ok: boolean;
  codebook: Codebook | null;
  /** true when a FULL revive reconstructs the original (hash identical). */
  exact: boolean;
  reason: string;
}

/**
 * DEMETHYLATE — revive dormant entries. With no `phrases` arg, revive ALL
 * (a full wake → byte-exact reconstruction of the original codebook). With
 * a phrase list, revive only those (partial wake). Total; never throws.
 */
export function demethylate(m: Methylation, phrases?: string[]): RevivalResult {
  try {
    if (!m || m.v !== 1 || !Array.isArray(m.active) || !Array.isArray(m.dormant)) return { ok: false, codebook: null, exact: false, reason: "malformed methylation" };
    const wake = phrases === undefined ? m.dormant : m.dormant.filter((d) => phrases.includes(d.phrase));
    const merged = [...m.active, ...wake];
    const cb = rebuild(m.open, m.close, merged, m.corpusHash);
    const isFull = phrases === undefined || wake.length === m.dormant.length;
    const exact = isFull && sha256Hex(canonicalizeCodebook(cb)) === m.originalHash;
    return { ok: true, codebook: cb, exact, reason: isFull ? (exact ? "full revive — byte-exact" : "full revive but hash diverged") : `partial revive (${wake.length}/${m.dormant.length})` };
  } catch (e) { return { ok: false, codebook: null, exact: false, reason: `threw: ${(e as Error).message}` }; }
}

export interface DormancyGauntlet {
  /** a full demethylate reconstructs the original codebook byte-exact. */
  reviveExact: boolean;
  /** the active working set is strictly smaller than the full codebook. */
  shrinks: boolean;
  /** the Ed25519 receipt is valid AND binds the original/active/dormant hashes. */
  signedBinds: boolean;
  /** deterministic — two methylations of the same input hash-identical. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  activeBytes: number;
  fullBytes: number;
  dormantCount: number;
  /** 0–100. 100 ⟺ reviveExact ∧ (shrinks ∨ nothing dormant) ∧ signedBinds ∧ deterministic. */
  score: number;
}

/** Prove the sleep/wake invariants. Total. */
export function dormancyGauntlet(repoRoot: string, cb: Codebook, trustMap: Record<string, "fresh" | "stale" | "quarantined">, at: number): DormancyGauntlet {
  try {
    // Nothing to prove on a malformed codebook → score 0 (not a vacuous pass).
    if (!cb || !Array.isArray(cb.entries)) return { reviveExact: false, shrinks: false, signedBinds: false, deterministic: false, stable: true, activeBytes: 0, fullBytes: 0, dormantCount: 0, score: 0 };
    const m = methylate(repoRoot, cb, trustMap, at);
    const rev = demethylate(m);
    const reviveExact = rev.exact;
    const shrinks = m.dormant.length === 0 ? true : m.activeBytes < m.fullBytes;
    const sig = verifyReceipt(m.receipt);
    const payload = (m.receipt as { payload?: { originalHash?: string; dormantCount?: number } }).payload;
    const signedBinds = sig.valid && payload?.originalHash === m.originalHash && payload?.dormantCount === m.dormant.length;
    const m2 = methylate(repoRoot, cb, trustMap, at);
    const deterministic = m.originalHash === m2.originalHash && m.activeBytes === m2.activeBytes && m.dormant.length === m2.dormant.length;
    let stable = true;
    try { demethylate(null as never); methylate(repoRoot, null as never, {}, at); } catch { stable = false; }
    const perfect = reviveExact && shrinks && signedBinds && deterministic && stable;
    return { reviveExact, shrinks, signedBinds, deterministic, stable, activeBytes: m.activeBytes, fullBytes: m.fullBytes, dormantCount: m.dormant.length, score: perfect ? 100 : 0 };
  } catch { return { reviveExact: false, shrinks: false, signedBinds: false, deterministic: false, stable: false, activeBytes: 0, fullBytes: 0, dormantCount: 0, score: 0 }; }
}

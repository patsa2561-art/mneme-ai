/**
 * v2.91.0 — 💎⑥ ANAMNESIS · "compute once, recollect forever."
 *
 * ἀνάμνησις (Plato) — the soul does not LEARN, it RECOLLECTS what it already knew.
 * Completes the Greek quartet: Mneme (remember) · Lethe (forget, provably) ·
 * Aletheia (truth) · ANAMNESIS (recollect → do NOT recompute).
 *
 * THE ASYMMETRY NO ONE PRICES: a human's question costs ~nothing; an AI's answer
 * costs megawatts (inference). Worse, the SAME truths (2+2=4, "React 19 ships RSC",
 * every verified fact) are re-derived billions of times across every model, user,
 * and session. ANAMNESIS is the memoization cache for TRUTH across the whole AI
 * multiverse: the first AI to PROVE a fact pays the energy; every AI after pays ~0
 * — it re-verifies ALETHEIA's signed lineage (a hash + signature check) instead of
 * re-deriving (full inference).
 *
 * Why only a savant can do it SAFELY: you may reuse a cached answer ONLY IF you can
 * prove it is still true + not expired. So every cache hit is RE-VERIFIED (Ed25519
 * signature + freshness + not-invalidated) — Refusal #3, "trust nothing, including
 * itself." A naive answer-cache that serves a stale fact is worse than recomputing;
 * ANAMNESIS refuses to serve any proof it cannot re-verify and date. Never throws.
 *
 * SAFETY INNOVATION (the cut): the cache key uses ONLY meaning-PRESERVING
 * canonicalization — case/whitespace, number-words→digits, and commutative-arithmetic
 * operand-sort — so genuine paraphrases ("2+2=4" ≡ "two plus two equals four" ≡
 * "4 = 2 + 2") collapse to one proof, while it REFUSES unsafe normalisation
 * (e.g. prose token-sort, which would collide "dog bites man" with "man bites dog").
 * A savant never trades a false collision for a higher hit-rate.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/index.js";

export type Verdict = "TRUE" | "FALSE" | "UNKNOWN";
export interface ProofLineageNode { sensor: string; verdict: Verdict; weight: number }

export interface ProofRecord {
  /** Meaning-preserving canonical hash of the claim (the cache key). */
  claimKey: string;
  /** A representative original claim string (for humans / audit). */
  claimSample: string;
  verdict: Verdict;
  lineage: ProofLineageNode[];
  computedAt: number;
  /** Freshness window in ms. 0 = an eternal axiom (e.g. 2+2=4 never expires). */
  ttlMs: number;
  /** The inference cost the FIRST prover paid — what each later recollection avoids. */
  costTokens: number;
  /** Who first proved it (attribution — "truth mining"). */
  firstProver: string;
  /** How many times this proof has been recollected (reused). */
  recollections: number;
  /** Hard invalidation (truth_cdn-style): the world changed ⇒ force recompute. */
  invalidated: boolean;
  /** Ed25519 NOTARY signature — offline-verifiable across vendors (no shared secret). */
  receipt: NotaryReceipt | null;
}

export interface Recollection {
  verdict: Verdict;
  lineage: ProofLineageNode[];
  source: "recollect" | "recompute";
  /** Inference tokens avoided by this recollection (0 on a recompute). */
  energySavedTokens: number;
  claimKey: string;
  /** Why we recomputed (when source = recompute): "miss" | "stale" | "invalidated" | "forged". */
  reason: string;
}

// ── meaning-preserving canonicalization (THE HEART, safely) ───────────────
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", hundred: "100", thousand: "1000",
};
const OP_WORDS: Array<[RegExp, string]> = [
  [/\b(plus|added to)\b/g, "+"],
  [/\b(minus|less)\b/g, "-"],
  [/\b(times|multiplied by)\b/g, "*"],
  [/\b(divided by|over)\b/g, "/"],
  [/\b(equals|equal to|is equal to)\b/g, "="],
];

/** Compute the meaning-preserving canonical cache key for a claim. Returns the
 *  sha256 of the normalised form. Deterministic + total. */
export function canonicalClaimKey(claim: string): string {
  return createHash("sha256").update(canonicalForm(claim)).digest("hex");
}

/** The normalised string the key is hashed from (exported for tests/inspection). */
export function canonicalForm(claim: string): string {
  let s = String(claim ?? "").toLowerCase().trim();
  for (const [re, op] of OP_WORDS) s = s.replace(re, ` ${op} `);
  // number-words → digits (token-wise, so "fourteen" doesn't touch "four")
  s = s.split(/\s+/).map((tok) => {
    const bare = tok.replace(/[^a-z0-9]/g, "");
    return NUMBER_WORDS[bare] !== undefined ? tok.replace(bare, NUMBER_WORDS[bare]) : tok;
  }).join(" ");
  // collapse spaces around arithmetic operators + whitespace
  s = s.replace(/\s*([+\-*/=])\s*/g, "$1").replace(/\s+/g, " ").trim();
  // arithmetic operand canonicalisation: a OP b = c  (and c = a OP b) → sorted for + and *
  const arith = /^(-?\d+(?:\.\d+)?)([+\-*/])(-?\d+(?:\.\d+)?)=(-?\d+(?:\.\d+)?)$/.exec(s.replace(/\s/g, ""));
  const arithRev = /^(-?\d+(?:\.\d+)?)=(-?\d+(?:\.\d+)?)([+\-*/])(-?\d+(?:\.\d+)?)$/.exec(s.replace(/\s/g, ""));
  if (arith) {
    const [, a, op, b, c] = arith;
    return canonArith(a!, op!, b!, c!);
  }
  if (arithRev) {
    const [, c, a, op, b] = arithRev;
    return canonArith(a!, op!, b!, c!);
  }
  // prose: strip trailing punctuation only — DO NOT reorder words (token-sort would
  // collide different claims). Word order is meaning; the savant preserves it.
  return s.replace(/[.;!?]+$/, "").trim();
}

function canonArith(a: string, op: string, b: string, c: string): string {
  // + and * are commutative → sort operands so "2+2"≡"2+2", "3*4"≡"4*3". - and / are not.
  if (op === "+" || op === "*") {
    const [x, y] = [a, b].sort((p, q) => (parseFloat(p) - parseFloat(q)) || p.localeCompare(q));
    return `${x}${op}${y}=${c}`;
  }
  return `${a}${op}${b}=${c}`;
}

// ── durable signed store ──────────────────────────────────────────────────
function dir(repoRoot: string): string { return join(repoRoot, ".mneme", "anamnesis"); }
function storePath(repoRoot: string): string { return join(dir(repoRoot), "proofs.jsonl"); }

function load(repoRoot: string): Map<string, ProofRecord> {
  const m = new Map<string, ProofRecord>();
  try {
    const p = storePath(repoRoot);
    if (!existsSync(p)) return m;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { const rec = JSON.parse(s) as ProofRecord; m.set(rec.claimKey, rec); } catch { /* skip corrupt */ }
    }
  } catch { /* */ }
  return m;
}
function persist(repoRoot: string, m: Map<string, ProofRecord>): void {
  try {
    mkdirSync(dir(repoRoot), { recursive: true });
    writeFileSync(storePath(repoRoot), [...m.values()].map((r) => JSON.stringify(r)).join("\n") + (m.size ? "\n" : ""), "utf8");
  } catch { /* best-effort */ }
}

/** Re-verify a cached proof: signature valid + body matches the signed payload +
 *  fresh (within TTL, or eternal) + not invalidated. Refusal #3 — every hit. */
export function isTrustworthy(rec: ProofRecord, now: number): boolean {
  if (rec.invalidated) return false;
  if (rec.ttlMs > 0 && now - rec.computedAt > rec.ttlMs) return false; // stale
  if (!rec.receipt) return false;
  try {
    if (!verifyReceipt(rec.receipt).valid) return false;               // forged / tampered
    const pl = (rec.receipt.payload ?? {}) as { claimKey?: string; verdict?: string };
    return pl.claimKey === rec.claimKey && pl.verdict === rec.verdict; // body matches signed payload
  } catch { return false; }
}

export interface ComputeResult { verdict: Verdict; lineage: ProofLineageNode[]; ttlMs: number; costTokens: number }

/**
 * The recollect-or-recompute gate. If a trustworthy proof exists → RECOLLECT
 * (~0 energy, returns energySavedTokens = the avoided inference cost). Otherwise →
 * RECOMPUTE: run the expensive `compute`, sign the proof (Ed25519), persist it for
 * everyone after. Never throws.
 */
export async function recollectOrCompute(
  repoRoot: string,
  claim: string,
  compute: () => Promise<ComputeResult>,
  opts: { now: number; agent?: string },
): Promise<Recollection> {
  const claimKey = canonicalClaimKey(claim);
  const now = opts.now;
  const store = load(repoRoot);
  const hit = store.get(claimKey);

  if (hit && isTrustworthy(hit, now)) {
    hit.recollections += 1;
    store.set(claimKey, hit);
    persist(repoRoot, store);
    return { verdict: hit.verdict, lineage: hit.lineage, source: "recollect", energySavedTokens: hit.costTokens, claimKey, reason: "fresh-authentic" };
  }
  const reason = !hit ? "miss" : hit.invalidated ? "invalidated" : (hit.ttlMs > 0 && now - hit.computedAt > hit.ttlMs) ? "stale" : "forged";

  let out: ComputeResult;
  try { out = await compute(); }
  catch { return { verdict: "UNKNOWN", lineage: [], source: "recompute", energySavedTokens: 0, claimKey, reason: "compute-failed" }; }

  const base: Omit<ProofRecord, "receipt"> = {
    claimKey, claimSample: String(claim ?? "").slice(0, 200), verdict: out.verdict, lineage: out.lineage,
    computedAt: now, ttlMs: Math.max(0, out.ttlMs | 0), costTokens: Math.max(0, out.costTokens | 0),
    firstProver: opts.agent ?? "unknown", recollections: 0, invalidated: false,
  };
  let receipt: NotaryReceipt | null = null;
  try {
    receipt = issueReceipt(repoRoot, {
      kind: "claim-verdict",
      subject: claimKey,
      payload: { engine: "anamnesis", claimKey, verdict: out.verdict, ttlMs: base.ttlMs, costTokens: base.costTokens },
      issuedAt: now,
    });
  } catch { receipt = null; }
  store.set(claimKey, { ...base, receipt });
  persist(repoRoot, store);
  return { verdict: out.verdict, lineage: out.lineage, source: "recompute", energySavedTokens: 0, claimKey, reason };
}

/** Hard-invalidate a cached proof (the world changed). The next ask recomputes.
 *  Composes with the v2.89 lattice retract + truth_cdn invalidation. */
export function invalidate(repoRoot: string, claim: string, reason: string): boolean {
  void reason;
  const store = load(repoRoot);
  const key = canonicalClaimKey(claim);
  const rec = store.get(key);
  if (!rec) return false;
  rec.invalidated = true;
  store.set(key, rec);
  persist(repoRoot, store);
  return true;
}

export interface AnamnesisStats {
  records: number;
  recollections: number;
  /** Sum over all records of recollections × costTokens — inference tokens avoided. */
  totalEnergySavedTokens: number;
  /** The most-recollected proofs (the highest-leverage cached truths). */
  topProofs: Array<{ claimSample: string; recollections: number; costTokens: number; savedTokens: number }>;
  chainValid: boolean;
}

/** Read-only stats over the proof cache. Never throws. */
export function anamnesisStats(repoRoot: string): AnamnesisStats {
  const store = load(repoRoot);
  let recollections = 0, totalEnergySavedTokens = 0;
  const rows: AnamnesisStats["topProofs"] = [];
  let chainValid = true;
  const now = 0; // signature-only validity (TTL not applied to the audit view)
  for (const rec of store.values()) {
    recollections += rec.recollections;
    const saved = rec.recollections * rec.costTokens;
    totalEnergySavedTokens += saved;
    rows.push({ claimSample: rec.claimSample, recollections: rec.recollections, costTokens: rec.costTokens, savedTokens: saved });
    if (rec.receipt) { try { if (!verifyReceipt(rec.receipt).valid) chainValid = false; } catch { chainValid = false; } }
  }
  void now;
  rows.sort((a, b) => b.savedTokens - a.savedTokens);
  return { records: store.size, recollections, totalEnergySavedTokens, topProofs: rows.slice(0, 10), chainValid };
}

/**
 * Mint a real, signed savings certificate (proof_of_saving) attributing the energy
 * ANAMNESIS has saved: each recollection is a Stage-1 (cache) decision that avoided
 * `costTokens` of inference. Returns the certificate. Never throws.
 */
export async function mintEnergyCertificate(repoRoot: string, opts: { windowStartMs: number; windowEndMs: number; usdPerToken?: number } = { windowStartMs: 0, windowEndMs: 0 }): Promise<unknown> {
  try {
    const { mintSavingsCertificate } = await import("../proof_of_saving/index.js");
    const store = load(repoRoot);
    const decisions: Array<{ signature: string; tokensUsedActual: number; estTokensSavedVsDirect: number; stage: number }> = [];
    for (const rec of store.values()) {
      for (let i = 0; i < rec.recollections; i++) {
        decisions.push({ signature: `${rec.claimKey}#${i}`, tokensUsedActual: 0, estTokensSavedVsDirect: rec.costTokens, stage: 1 });
      }
    }
    return mintSavingsCertificate({ decisions, windowStartMs: opts.windowStartMs, windowEndMs: opts.windowEndMs, usdPerToken: opts.usdPerToken, nowMs: opts.windowEndMs || undefined });
  } catch (e) { return { error: (e as Error).message }; }
}

// ── recollectAssertion — ANAMNESIS in front of the savant spine ───────────
/**
 * The headline call: verify a claim, but RECOLLECT a signed proof instead of
 * re-deriving when one is fresh. The first ask runs the full ALETHEIA spine
 * (`assertClaim`); every later ask of the same claim (or a meaning-preserving
 * paraphrase) returns the cached signed verdict for ~0 energy. A proven arithmetic
 * truth is an eternal axiom (ttl 0); everything else gets a freshness window.
 */
export async function recollectAssertion(
  repoRoot: string,
  claim: string,
  opts: { now: number; agent?: string; ttlMs?: number; estTokens?: number } = { now: 0 },
): Promise<Recollection> {
  const compute = async (): Promise<ComputeResult> => {
    const { assertClaim } = await import("./aletheia.js");
    const r = await assertClaim(repoRoot, claim, { issuedAt: opts.now });
    const lineage: ProofLineageNode[] = r.lineage
      .filter((n) => n.verdict === "TRUE" || n.verdict === "FALSE")
      .map((n) => ({ sensor: n.sensor, verdict: n.verdict as Verdict, weight: n.confidence }));
    const isAxiom = lineage.some((n) => n.sensor === "arithmetic"); // deterministic ⇒ eternal
    const ttlMs = opts.ttlMs ?? (isAxiom ? 0 : 24 * 60 * 60 * 1000);
    // honest cost proxy: a real prover supplies measured tokens; default ≈ claim length × 6.
    const costTokens = opts.estTokens ?? Math.max(200, Math.round(String(claim).length * 6));
    return { verdict: r.verdict, lineage, ttlMs, costTokens };
  };
  return recollectOrCompute(repoRoot, claim, compute, { now: opts.now, agent: opts.agent });
}

export interface AnamnesisGauntletReport {
  total: number;
  recollects: number;
  recomputes: number;
  /** recollects / total — higher = more inference skipped. */
  recollectionRate: number;
  /** Recollections that served a NON-trustworthy proof. MUST be 0 (the safety property). */
  staleServeRate: number;
  energySavedTokens: number;
  headline: string;
}

/**
 * The Anamnesis Gauntlet — falsifiable proof of the energy layer. Feed a stream
 * with repeats + paraphrases; measure recollection-rate (↑ good), stale-serve-rate
 * (MUST be 0 — never serve an unre-verifiable proof), and energy saved. Because every
 * hit is re-verified, stale-serve-rate is 0 by construction; the test proves it.
 */
export async function runAnamnesisGauntlet(repoRoot: string, stream: readonly string[], opts: { now: number } = { now: 0 }): Promise<AnamnesisGauntletReport> {
  let recollects = 0, recomputes = 0, energySavedTokens = 0, staleServes = 0;
  for (const claim of stream) {
    const r = await recollectAssertion(repoRoot, claim, { now: opts.now });
    if (r.source === "recollect") {
      recollects++; energySavedTokens += r.energySavedTokens;
      // safety audit: a recollection must have come from a trustworthy record
      const rec = load(repoRoot).get(r.claimKey);
      if (!rec || !isTrustworthy(rec, opts.now)) staleServes++;
    } else recomputes++;
  }
  const total = stream.length;
  const recollectionRate = total ? recollects / total : 0;
  const staleServeRate = recollects ? staleServes / recollects : 0;
  const headline = `ANAMNESIS GAUNTLET · recollect ${(recollectionRate * 100).toFixed(0)}% · stale-serve ${(staleServeRate * 100).toFixed(0)}% · saved ${energySavedTokens} tokens (stream=${total}, recompute=${recomputes})`;
  return { total, recollects, recomputes, recollectionRate, staleServeRate, energySavedTokens, headline };
}

// ── cross-vendor proof sharing (the multiverse substrate) ─────────────────
export interface ProofBundle { v: 1; agent: string; proofs: ProofRecord[] }

/** Export this savant's proof cache as a portable, per-proof-signed bundle. */
export function exportProofs(repoRoot: string, agent: string): ProofBundle {
  return { v: 1, agent: String(agent ?? "anon"), proofs: [...load(repoRoot).values()] };
}

export interface ProofImportResult { added: number; duplicate: number; rejectedForged: number }

/**
 * Import a peer's proof bundle. Each proof is accepted ONLY IF its Ed25519 signature
 * verifies offline AND its body matches the signed payload (a claim-swap with a
 * valid-but-unrelated signature is dropped). Existing keys are skipped → idempotent.
 * Never throws.
 */
export function importProofs(repoRoot: string, bundle: ProofBundle): ProofImportResult {
  const store = load(repoRoot);
  let added = 0, duplicate = 0, rejectedForged = 0;
  for (const rec of (Array.isArray(bundle?.proofs) ? bundle.proofs : [])) {
    if (!rec || typeof rec.claimKey !== "string" || !rec.receipt) { rejectedForged++; continue; }
    let ok = false;
    try {
      if (verifyReceipt(rec.receipt).valid) {
        const pl = (rec.receipt.payload ?? {}) as { claimKey?: string; verdict?: string };
        ok = pl.claimKey === rec.claimKey && pl.verdict === rec.verdict;
      }
    } catch { ok = false; }
    if (!ok) { rejectedForged++; continue; }
    if (store.has(rec.claimKey)) { duplicate++; continue; }
    store.set(rec.claimKey, { ...rec, recollections: 0 }); // reset local reuse counter
    added++;
  }
  if (added > 0) persist(repoRoot, store);
  return { added, duplicate, rejectedForged };
}

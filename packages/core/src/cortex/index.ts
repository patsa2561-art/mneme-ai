/**
 * v2.104.0 — THE COGNITIVE CORTEX (Sovereign Memory Bus).
 *
 * The honest, buildable heart of the "Universal Memory Bus / Cognitive Mesh"
 * vision: a LOCAL, vendor-neutral, SIGNED, drift-guarded shared memory that
 * ANY AI agent — Grok / GPT / Gemini / Claude / Codex / a local model —
 * contributes to and recalls from. Mneme is the LOGIC GATEKEEPER: every
 * contribution is Ed25519-signed (provenance) and, critically, a value that
 * CONTRADICTS established shared memory is QUARANTINED, not silently
 * overwritten — so the mesh cannot be poisoned or drift out from under the
 * agents sharing it.
 *
 * DIAKRISIS — what this deliberately is NOT: it is not a kernel driver and
 * not process/VRAM injection (that is malware-class and, for a cloud agent,
 * fantasy). It is a clean, safe, cross-vendor protocol surface (MCP / the
 * existing HTTP bridge). We ship the part that empowers every agent and is
 * measurable, and refuse the part that is dangerous theatre.
 *
 * Four booleans that cannot lie: round-trip (contribute→recall) ∧
 * quarantines-conflict ∧ signed (offline-verifiable, tamper-evident) ∧
 * deterministic. Every function is total (108-error rule): garbage in → the
 * safest result, never a throw. The shared brain of all agents must never
 * crash the host.
 */

import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

export type CortexKind = "fact" | "decision" | "context" | "warning";

export interface Contribution {
  agent: string;
  key: string;
  value: string;
  kind?: CortexKind;
}

export interface CortexEntry {
  id: string;
  agent: string;
  key: string;
  value: string;
  kind: CortexKind;
  /** id of the entry this one supersedes (declared update), or null. */
  supersedes: string | null;
  at: number;
  receipt: NotaryReceipt;
}

export interface CortexStore {
  v: 1;
  entries: CortexEntry[];
}

export function emptyStore(): CortexStore { return { v: 1, entries: [] }; }

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function str(x: unknown, max = 4000): string { return (typeof x === "string" ? x : "").slice(0, max); }
function entryPayload(c: { agent: string; key: string; value: string; kind: CortexKind; supersedes: string | null; at: number }): Record<string, unknown> {
  return { agent: c.agent, key: c.key, value: c.value, kind: c.kind, supersedes: c.supersedes, at: c.at };
}

/** The latest non-superseded entry for each key (the live shared memory). */
export function activeView(store: CortexStore): Map<string, CortexEntry> {
  const superseded = new Set<string>();
  const byId = new Map<string, CortexEntry>();
  const entries = store && Array.isArray(store.entries) ? store.entries : [];
  for (const e of entries) { if (e) { byId.set(e.id, e); if (e.supersedes) superseded.add(e.supersedes); } }
  const latest = new Map<string, CortexEntry>();
  for (const e of entries) {
    if (!e || superseded.has(e.id)) continue;
    const prev = latest.get(e.key);
    if (!prev || e.at >= prev.at) latest.set(e.key, e);
  }
  return latest;
}

export type ContributeVerdict = "ACCEPTED" | "DUPLICATE" | "UPDATED" | "QUARANTINED";

export interface ContributeResult {
  verdict: ContributeVerdict;
  entry: CortexEntry | null;
  /** id of the established entry a QUARANTINED contribution conflicts with. */
  conflictsWith: string | null;
  reason: string;
}

/**
 * THE GATEKEEPER. Contribute a fact to the shared cortex:
 *   - identical key+value already present  → DUPLICATE (agents agree; no-op)
 *   - same key, NEW value, opts.update     → UPDATED (declared supersede)
 *   - same key, NEW value, no update        → QUARANTINED (drift! refused —
 *                                             established memory is not
 *                                             silently overwritten)
 *   - new key                               → ACCEPTED
 * The accepted/updated entry is Ed25519-signed. Total; never throws.
 */
export function contribute(repoRoot: string, store: CortexStore, c: Contribution, at: number, opts?: { update?: boolean }): { store: CortexStore; result: ContributeResult } {
  try {
    const safe: CortexStore = store && Array.isArray(store.entries) ? store : emptyStore();
    const agent = str(c?.agent, 120) || "unknown";
    const key = str(c?.key, 400);
    const value = str(c?.value);
    const kind: CortexKind = (["fact", "decision", "context", "warning"] as const).includes(c?.kind as CortexKind) ? c!.kind as CortexKind : "fact";
    if (!key || !value) return { store: safe, result: { verdict: "QUARANTINED", entry: null, conflictsWith: null, reason: "empty key or value" } };

    const active = activeView(safe);
    const existing = active.get(key);
    if (existing) {
      if (existing.value === value) return { store: safe, result: { verdict: "DUPLICATE", entry: existing, conflictsWith: null, reason: "identical fact already in the cortex (agents agree)" } };
      if (!opts?.update) return { store: safe, result: { verdict: "QUARANTINED", entry: null, conflictsWith: existing.id, reason: `conflicts with established memory for key (set update=true to declare a supersede)` } };
    }
    const supersedes = existing && opts?.update ? existing.id : null;
    const base = { agent, key, value, kind, supersedes, at };
    const id = sha256(JSON.stringify(entryPayload(base)));
    const receipt = issueReceipt(repoRoot, { kind: "memory-capsule", subject: `cortex:${key.slice(0, 40)}`, payload: { ...entryPayload(base), id }, includePayload: true, issuedAt: at });
    const entry: CortexEntry = { id, ...base, receipt };
    return { store: { v: 1, entries: [...safe.entries, entry] }, result: { verdict: supersedes ? "UPDATED" : "ACCEPTED", entry, conflictsWith: null, reason: supersedes ? "superseded prior value (declared update)" : "new fact accepted into the cortex" } };
  } catch (e) {
    return { store: store ?? emptyStore(), result: { verdict: "QUARANTINED", entry: null, conflictsWith: null, reason: `threw: ${(e as Error).message}` } };
  }
}

export interface RecallHit { entry: CortexEntry; score: number }

/** Recall shared memory relevant to a query (deterministic token overlap on
 *  key+value), most-relevant + most-recent first. Total. */
export function recall(store: CortexStore, query: string, limit = 10): RecallHit[] {
  try {
    const q = str(query, 400).toLowerCase().split(/\W+/).filter((t) => t.length > 1);
    if (q.length === 0) return [];
    const active = [...activeView(store).values()];
    const hits: RecallHit[] = [];
    for (const e of active) {
      const hay = (e.key + " " + e.value).toLowerCase();
      let score = 0;
      for (const t of q) if (hay.includes(t)) score++;
      if (score > 0) hits.push({ entry: e, score });
    }
    hits.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at);
    return hits.slice(0, Math.max(0, limit));
  } catch { return []; }
}

export interface VerifyEntryResult { valid: boolean; bound: boolean; reason: string }

/** Verify a cortex entry OFFLINE: signature valid AND the receipt binds this
 *  exact (agent,key,value,id). Catches tampering. Total. */
export function verifyEntry(entry: CortexEntry): VerifyEntryResult {
  try {
    if (!entry || !entry.receipt) return { valid: false, bound: false, reason: "no entry/receipt" };
    const v = verifyReceipt(entry.receipt);
    if (!v.valid) return { valid: false, bound: false, reason: v.reason ?? "bad signature" };
    const p = (entry.receipt as { payload?: Record<string, unknown> }).payload;
    // Bind EVERY signed field. The id is derived from the full payload
    // (agent,key,value,kind,supersedes,at), so recomputing it from the
    // entry's current fields and matching it to the signed id catches a
    // tamper of ANY field — including kind and at (which feed activeView +
    // handoff). We also check each field explicitly, belt-and-suspenders.
    const recomputedId = sha256(JSON.stringify(entryPayload(entry)));
    const bound = !!p
      && p.id === entry.id && recomputedId === entry.id
      && p.agent === entry.agent && p.key === entry.key && p.value === entry.value
      && p.kind === entry.kind && p.supersedes === entry.supersedes && p.at === entry.at;
    return { valid: true, bound, reason: bound ? "signed + bound to this entry" : "signature valid but entry does not match receipt (tampered)" };
  } catch (e) { return { valid: false, bound: false, reason: `threw: ${(e as Error).message}` }; }
}

export interface HandoffCapsule {
  kind: "cortex/handoff";
  toAgent: string;
  facts: Array<{ key: string; value: string; agent: string; kind: CortexKind }>;
  at: number;
  receipt: NotaryReceipt;
}

/** Build a SIGNED context capsule (the live shared memory) for a receiving
 *  agent — "feed clean, verified context to the next agent". Total. */
export function handoff(repoRoot: string, store: CortexStore, toAgent: string, at: number): HandoffCapsule {
  const facts = [...activeView(store).values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((e) => ({ key: e.key, value: e.value, agent: e.agent, kind: e.kind }));
  // Canonical digest: sort each fact's keys so the hash is stable regardless
  // of object key insertion order (consistent with notary's canonicalJson).
  const canonFacts = facts.map((f) => Object.keys(f).sort().map((k) => [k, (f as Record<string, unknown>)[k]]));
  const digest = sha256(JSON.stringify(canonFacts));
  const receipt = issueReceipt(repoRoot, { kind: "memory-capsule", subject: `cortex-handoff:${str(toAgent, 80) || "agent"}`, payload: { toAgent: str(toAgent, 80), digest, count: facts.length }, includePayload: true, issuedAt: at });
  return { kind: "cortex/handoff", toAgent: str(toAgent, 80) || "agent", facts, at, receipt };
}

// ════════════════════════════════════════════════════════════════════
//  RECONCILIATION — the self-healing power: a conflict isn't a dead end.
//  When two agents disagree, the cortex tries to resolve it by PROOF
//  (the truth kernel), not by vote or recency. If exactly one claim is
//  verifiably FALSE, the other wins — signed. If neither can be proven
//  false, it stays quarantined and emits a signed belief-diff for a human
//  or a trusted agent to settle (the Padgett rule — never auto-decide an
//  opinion). This works for EVERY vendor: Grok / GPT / Gemini / Claude all
//  consume the same signed verdict and verify it offline. No shared-memory
//  system on earth resolves agent contradictions by verifiable truth.
// ════════════════════════════════════════════════════════════════════

export type ReconcileResolution = "proof" | "unresolved";

export interface ReconcileResult {
  resolution: ReconcileResolution;
  winner: { agent: string; value: string } | null;
  loser: { agent: string; value: string } | null;
  verdicts: { a: string; b: string };
  reason: string;
  receipt: NotaryReceipt;
}

/**
 * Reconcile two conflicting contributions by PROOF. Async (consults the
 * truth kernel). Total: any failure → an honest "unresolved" verdict, never
 * a throw.
 */
export async function reconcile(repoRoot: string, a: { agent: string; value: string }, b: { agent: string; value: string }, at: number): Promise<ReconcileResult> {
  let va = "UNKNOWN", vb = "UNKNOWN";
  try {
    const aletheia = await import("../truth_kernel/aletheia.js");
    const ra = await aletheia.assertClaim(repoRoot, str(a?.value), {});
    const rb = await aletheia.assertClaim(repoRoot, str(b?.value), {});
    va = ra?.verdict ?? "UNKNOWN"; vb = rb?.verdict ?? "UNKNOWN";
  } catch { /* truth kernel unavailable → stays unresolved */ }

  let resolution: ReconcileResolution = "unresolved";
  let winner: ReconcileResult["winner"] = null;
  let loser: ReconcileResult["loser"] = null;
  let reason: string;
  // Auto-resolve ONLY when exactly one side is verifiably FALSE (proven).
  if (va === "FALSE" && vb !== "FALSE") { resolution = "proof"; winner = { agent: str(b?.agent, 120), value: str(b?.value) }; loser = { agent: str(a?.agent, 120), value: str(a?.value) }; reason = `claim A is verifiably FALSE — B wins by proof`; }
  else if (vb === "FALSE" && va !== "FALSE") { resolution = "proof"; winner = { agent: str(a?.agent, 120), value: str(a?.value) }; loser = { agent: str(b?.agent, 120), value: str(b?.value) }; reason = `claim B is verifiably FALSE — A wins by proof`; }
  else { reason = `neither claim is provably false (verdicts ${va}/${vb}) — quarantine holds; signed belief-diff for human/trusted-agent resolution`; }

  const receipt = issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `cortex-reconcile:${sha256(str(a?.value) + "|" + str(b?.value)).slice(0, 16)}`,
    payload: { resolution, winnerValue: winner?.value ?? null, loserValue: loser?.value ?? null, verdicts: { a: va, b: vb }, a: { agent: str(a?.agent, 120), value: str(a?.value) }, b: { agent: str(b?.agent, 120), value: str(b?.value) } },
    includePayload: true,
    issuedAt: at,
  });
  return { resolution, winner, loser, verdicts: { a: va, b: vb }, reason, receipt };
}

export interface ReconcileGauntlet {
  /** a verifiably-false claim loses to a true one (resolution=proof). */
  proofResolves: boolean;
  /** two unprovable opinions stay unresolved (no auto-decide; Padgett). */
  opinionUnresolved: boolean;
  /** the reconciliation verdict is signed + offline-verifiable. */
  signed: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the reconciliation power. Async + total. */
export async function reconcileGauntlet(repoRoot: string, at: number): Promise<ReconcileGauntlet> {
  try {
    const proof = await reconcile(repoRoot, { agent: "claude", value: "2+2=4" }, { agent: "grok", value: "2+2=5" }, at);
    const proofResolves = proof.resolution === "proof" && proof.winner?.value === "2+2=4" && proof.loser?.value === "2+2=5";
    const opinion = await reconcile(repoRoot, { agent: "claude", value: "fly.io is the deploy target" }, { agent: "grok", value: "vercel is the deploy target" }, at);
    const opinionUnresolved = opinion.resolution === "unresolved" && opinion.winner === null;
    const signed = verifyReceipt(proof.receipt).valid;
    let stable = true;
    try { await reconcile(repoRoot, null as never, null as never, at); } catch { stable = false; }
    const perfect = proofResolves && opinionUnresolved && signed && stable;
    return { proofResolves, opinionUnresolved, signed, stable, score: perfect ? 100 : 0 };
  } catch { return { proofResolves: false, opinionUnresolved: false, signed: false, stable: false, score: 0 }; }
}

export interface CortexGauntlet {
  roundTrip: boolean;
  quarantinesConflict: boolean;
  signed: boolean;
  tamperCaught: boolean;
  deterministic: boolean;
  stable: boolean;
  score: number;
}

/** Prove the cortex invariants. Total. */
export function cortexGauntlet(repoRoot: string, at: number): CortexGauntlet {
  try {
    let s = emptyStore();
    // 1) accept + recall round-trip
    s = contribute(repoRoot, s, { agent: "claude", key: "db.url", value: "postgres://prod", kind: "fact" }, at).store;
    const found = recall(s, "db url").some((h) => h.entry.value === "postgres://prod");
    // 2) duplicate from another agent → DUPLICATE (agree)
    const dup = contribute(repoRoot, s, { agent: "gpt", key: "db.url", value: "postgres://prod" }, at + 1).result.verdict === "DUPLICATE";
    // 3) conflict → QUARANTINED, active value unchanged
    const conf = contribute(repoRoot, s, { agent: "grok", key: "db.url", value: "postgres://EVIL" }, at + 2);
    const quarantinesConflict = conf.result.verdict === "QUARANTINED" && activeView(conf.store).get("db.url")?.value === "postgres://prod";
    // 4) declared update → supersede
    const upd = contribute(repoRoot, s, { agent: "claude", key: "db.url", value: "postgres://prod2" }, at + 3, { update: true });
    const updated = upd.result.verdict === "UPDATED" && activeView(upd.store).get("db.url")?.value === "postgres://prod2";
    // signed + tamper
    const entry = activeView(s).get("db.url")!;
    const signed = verifyEntry(entry).bound;
    const tampered = JSON.parse(JSON.stringify(entry)); tampered.value = "postgres://HACKED";
    const tamperCaught = verifyEntry(tampered).bound === false;
    // deterministic handoff digest
    const h1 = handoff(repoRoot, s, "x", at).receipt.payloadHash;
    const h2 = handoff(repoRoot, s, "x", at).receipt.payloadHash;
    const deterministic = h1 === h2;
    let stable = true;
    try { contribute(repoRoot, null as never, null as never, at); recall(null as never, null as never); verifyEntry(null as never); handoff(repoRoot, null as never, null as never, at); } catch { stable = false; }
    const perfect = found && dup && quarantinesConflict && updated && signed && tamperCaught && deterministic && stable;
    return { roundTrip: found, quarantinesConflict, signed, tamperCaught, deterministic, stable, score: perfect ? 100 : 0 };
  } catch { return { roundTrip: false, quarantinesConflict: false, signed: false, tamperCaught: false, deterministic: false, stable: false, score: 0 }; }
}

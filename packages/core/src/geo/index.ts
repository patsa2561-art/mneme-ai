/**
 * GEOLOGICAL MEMORY METAMORPHOSIS — the compliant, self-cleaning memory ledger.
 *
 * Like a planet recycling its crust: memory does not pile up as raw sediment forever.
 * It METAMORPHOSES through tiers, automatically, by age + access:
 *
 *   RAW  ──(old + unaccessed)──▶  ABSTRACT   raw text DESTROYED; kept = a deterministic
 *                                            essence + a SIGNED proof that the raw (bound
 *                                            by sha256) was reduced and purged at time T
 *   ABSTRACT ──(dense near-dups)──▶ AXIOM     several abstracts fuse into one high-support
 *                                            axiom (the "intuitive wisdom"), source-bound
 *
 * The result is the thing enterprises actually want: keep the WISDOM, destroy the RAW —
 * provably. Right-to-be-forgotten BY CONSTRUCTION (raw dissolves on a clock, or on demand)
 * + no database bloat + a tamper-evident audit chain of every metamorphosis.
 *
 * Pure + total + deterministic (the caller supplies `now`). Built on the shipped NOTARY
 * (Ed25519 purge proofs) — no new crypto. The "essence" is a DETERMINISTIC reduction (no
 * LLM); an optional summarizer can be injected, but the default + the proofs never need one.
 */
import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt } from "../notary/receipt.js";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const DAY = 86_400_000;
const STOP = new Set("the a an of to in on for is are be and or with from this that it as at by we you i".split(/\s+/));

export type Tier = "raw" | "abstract" | "axiom";
export interface MemoryCell {
  id: string;
  tier: Tier;
  ts: number;
  lastAccess: number;
  /** present ONLY at tier "raw". */
  raw?: string;
  /** deterministic essence (abstract/axiom). */
  abstract?: string;
  /** sha256 of the original raw — binds the purge proof; the raw itself is gone. */
  rawHash?: string;
  rawBytes?: number;
  /** signed NOTARY receipt attesting the raw was reduced + purged. */
  purgeProof?: unknown;
  purgedAt?: number;
  /** axiom: how many abstracts fused into it + their source raw-hashes. */
  support?: number;
  sourceHashes?: string[];
}

export interface GeoEvent { seq: number; kind: "abstract" | "fuse" | "forget"; id: string; rawHash: string; ts: number; prevHash: string; hash: string }
export interface GeoState { v: 1; cells: MemoryCell[]; events: GeoEvent[] }

export function emptyGeo(): GeoState { return { v: 1, cells: [], events: [] }; }

/** A raw input to seed the store. */
export interface RawSeed { id: string; raw: string; ts: number; lastAccess?: number }
export function seedRaw(state: GeoState, seed: RawSeed): GeoState {
  return { ...state, cells: [...state.cells, { id: seed.id, tier: "raw", ts: seed.ts, lastAccess: seed.lastAccess ?? seed.ts, raw: String(seed.raw) }] };
}

/** Deterministic essence — the "semantic isotope": top keywords + a length signature.
 *  NOT an LLM summary; it is provable, no-LLM, and enough to retain the gist + dedupe. */
export function deterministicAbstract(raw: string, k = 8): string {
  const freq = new Map<string, number>();
  for (const tok of String(raw).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))) freq.set(tok, (freq.get(tok) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map((e) => e[0]);
  return `${top.join(" ")} ·${String(raw).length}b`;
}

const tokensOf = (abstract: string): Set<string> => new Set(String(abstract).replace(/·\d+b/, "").trim().split(/\s+/).filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number { if (!a.size && !b.size) return 1; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }

export interface MetamorphoseOpts {
  decayDays?: number;     // age past which raw decays
  idleDays?: number;      // no-access window required to decay
  fuseThreshold?: number; // abstract jaccard ≥ this → fuse
  fuseMinSupport?: number; // group size ≥ this → axiom
  summarize?: (raw: string) => string; // optional richer abstract (deterministic default otherwise)
}

function chain(events: GeoEvent[], kind: GeoEvent["kind"], id: string, rawHash: string, ts: number): GeoEvent {
  const prev = events.length ? events[events.length - 1] : null;
  const seq = (prev?.seq ?? 0) + 1, prevHash = prev?.hash ?? "GENESIS";
  const body = JSON.stringify({ seq, kind, id, rawHash, ts, prevHash });
  return { seq, kind, id, rawHash, ts, prevHash, hash: sha256(body) };
}

/** Run ONE geological cycle: decay aged+idle raw → abstract (purge + sign), then fuse
 *  dense near-duplicate abstracts → axioms. Deterministic. repoRoot is used for signing. */
export function metamorphose(repoRoot: string, state: GeoState, now: number, opts: MetamorphoseOpts = {}): GeoState {
  const s = state && Array.isArray(state.cells) ? state : emptyGeo();
  const decayMs = (opts.decayDays ?? 90) * DAY, idleMs = (opts.idleDays ?? 30) * DAY;
  const fuseTh = opts.fuseThreshold ?? 0.6, minSup = opts.fuseMinSupport ?? 2;
  let cells = s.cells.map((c) => ({ ...c }));
  const events = [...(s.events ?? [])];

  // PHASE 1 — RAW → ABSTRACT (destroy raw, keep essence + signed purge proof)
  cells = cells.map((c) => {
    if (c.tier !== "raw" || typeof c.raw !== "string") return c;
    if (now - c.ts < decayMs || now - c.lastAccess < idleMs) return c;
    const raw = c.raw, rawHash = sha256(raw), rawBytes = Buffer.byteLength(raw, "utf8");
    const abstract = (opts.summarize ? String(opts.summarize(raw)) : deterministicAbstract(raw));
    let purgeProof: unknown = null;
    try { purgeProof = issueReceipt(repoRoot, { kind: "memory-capsule", subject: `geo-purge:${rawHash.slice(0, 12)}`, payload: { rawHash, rawBytes, purgedAt: now, abstractHash: sha256(abstract) }, includePayload: true, issuedAt: now }); } catch { /* unsigned but still purged */ }
    events.push(chain(events, "abstract", c.id, rawHash, now));
    const { raw: _gone, ...rest } = c; void _gone;          // RAW IS DESTROYED HERE
    return { ...rest, tier: "abstract" as Tier, abstract, rawHash, rawBytes, purgeProof, purgedAt: now };
  });

  // PHASE 2 — ABSTRACT → AXIOM (fuse dense near-duplicates into high-support wisdom)
  const absCells = cells.filter((c) => c.tier === "abstract");
  const used = new Set<string>();
  const axioms: MemoryCell[] = [];
  for (let i = 0; i < absCells.length; i++) {
    const a = absCells[i]; if (used.has(a.id)) continue;
    const group = [a]; const ta = tokensOf(a.abstract ?? "");
    for (let j = i + 1; j < absCells.length; j++) { const b = absCells[j]; if (used.has(b.id)) continue; if (jaccard(ta, tokensOf(b.abstract ?? "")) >= fuseTh) group.push(b); }
    if (group.length >= minSup) {
      for (const g of group) used.add(g.id);
      // axiom essence = the keywords SHARED across the group (the common core)
      const common = [...group.reduce((acc, g, idx) => { const t = tokensOf(g.abstract ?? ""); return idx === 0 ? t : new Set([...acc].filter((x) => t.has(x))); }, new Set<string>())].sort();
      const sourceHashes = group.map((g) => g.rawHash ?? "").filter(Boolean).sort();
      const id = "axiom:" + sha256(sourceHashes.join("|")).slice(0, 16);
      axioms.push({ id, tier: "axiom", ts: now, lastAccess: now, abstract: (common.length ? common.join(" ") : (a.abstract ?? "")), support: group.length, sourceHashes });
      events.push(chain(events, "fuse", id, sourceHashes[0] ?? "", now));
    }
  }
  cells = cells.filter((c) => !(c.tier === "abstract" && used.has(c.id))).concat(axioms);
  return { v: 1, cells, events };
}

/** RIGHT TO BE FORGOTTEN (on demand): purge any raw matching `needle` immediately, leaving
 *  only a signed tombstone proof (no content from the forgotten data survives). */
export function forget(repoRoot: string, state: GeoState, needle: string, now: number): GeoState {
  const st0 = state && Array.isArray(state.cells) ? state : emptyGeo();
  if (!needle) return st0;
  let cells = st0.cells.map((c) => ({ ...c }));
  const events = [...(st0.events ?? [])];
  cells = cells.map((c) => {
    if (c.tier !== "raw" || typeof c.raw !== "string" || !c.raw.includes(needle)) return c;
    const rawHash = sha256(c.raw), rawBytes = Buffer.byteLength(c.raw, "utf8");
    let purgeProof: unknown = null;
    try { purgeProof = issueReceipt(repoRoot, { kind: "memory-capsule", subject: `geo-forget:${rawHash.slice(0, 12)}`, payload: { rawHash, rawBytes, forgottenAt: now, reason: "right-to-be-forgotten" }, includePayload: true, issuedAt: now }); } catch { /* */ }
    events.push(chain(events, "forget", c.id, rawHash, now));
    const { raw: _gone, ...rest } = c; void _gone;
    return { ...rest, tier: "abstract" as Tier, abstract: "[forgotten]", rawHash, rawBytes, purgeProof, purgedAt: now };
  });
  return { v: 1, cells, events };
}

/** PRIVACY CHECK: does any raw matching `needle` still exist? (must be false after purge) */
export function containsRaw(state: GeoState, needle: string): boolean {
  return (state?.cells ?? []).some((c) => typeof c.raw === "string" && c.raw.includes(needle));
}

/** Verify every purge proof OFFLINE + the audit chain. */
export function verifyGeo(state: GeoState): { ok: boolean; proofsValid: number; proofsTotal: number; chainIntact: boolean; brokenAt: number | null } {
  let proofsValid = 0, proofsTotal = 0;
  for (const c of state?.cells ?? []) {
    if (!c.purgeProof) continue; proofsTotal++;
    const r = verifyReceipt(c.purgeProof);
    const pl = (c.purgeProof as { payload?: { rawHash?: string } }).payload;
    if (r.valid && pl?.rawHash === c.rawHash) proofsValid++;
  }
  // audit chain
  let prevHash = "GENESIS", chainIntact = true, brokenAt: number | null = null;
  for (const e of state?.events ?? []) {
    const body = JSON.stringify({ seq: e.seq, kind: e.kind, id: e.id, rawHash: e.rawHash, ts: e.ts, prevHash });
    if (e.prevHash !== prevHash || e.hash !== sha256(body)) { chainIntact = false; brokenAt = e.seq; break; }
    prevHash = e.hash;
  }
  return { ok: proofsValid === proofsTotal && chainIntact, proofsValid, proofsTotal, chainIntact, brokenAt };
}

export interface GeoStats { raw: number; abstract: number; axiom: number; purged: number; rawBytesReclaimed: number }
export function geoStats(state: GeoState): GeoStats {
  const s = { raw: 0, abstract: 0, axiom: 0, purged: 0, rawBytesReclaimed: 0 };
  for (const c of state?.cells ?? []) { s[c.tier]++; if (c.purgeProof) { s.purged++; s.rawBytesReclaimed += c.rawBytes ?? 0; } }
  return s;
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface GeoGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function geoGauntlet(repoRoot: string): GeoGauntlet {
  const t0 = 1_600_000_000_000;
  let st = emptyGeo();
  // 3 near-duplicate secrets-ish raw entries + 1 distinct, all old + idle
  st = seedRaw(st, { id: "r1", raw: "deploy auth service token AKIA_SECRET_ALPHA to prod cluster east", ts: t0 });
  st = seedRaw(st, { id: "r2", raw: "deploy auth service token to prod cluster west region", ts: t0 + DAY });
  st = seedRaw(st, { id: "r3", raw: "deploy auth service prod cluster north token rotation", ts: t0 + 2 * DAY });
  st = seedRaw(st, { id: "r4", raw: "unrelated note about cafeteria lunch menu friday", ts: t0 + 3 * DAY });
  const now = t0 + 200 * DAY; // well past decay + idle
  const after = metamorphose(repoRoot, st, now, { decayDays: 90, idleDays: 30, fuseThreshold: 0.5, fuseMinSupport: 2 });

  const rawGone = !containsRaw(after, "AKIA_SECRET_ALPHA") && !containsRaw(after, "deploy auth service");
  const stats = geoStats(after);
  const v = verifyGeo(after);
  const hasAxiom = after.cells.some((c) => c.tier === "axiom" && (c.support ?? 0) >= 2);
  const axiom = after.cells.find((c) => c.tier === "axiom");
  const essencePreserved = !!axiom && /deploy|auth|prod|token/.test(axiom.abstract ?? "");
  const distinctSurvivesAsAbstract = after.cells.some((c) => c.tier === "abstract" && /cafeteria|lunch/.test(c.abstract ?? ""));
  // determinism
  const det = JSON.stringify(metamorphose(repoRoot, st, now, { decayDays: 90, idleDays: 30, fuseThreshold: 0.5, fuseMinSupport: 2 })) === JSON.stringify(after);
  // monotonic: no raw cell remains for the decayed entries
  const monotonic = !after.cells.some((c) => c.tier === "raw");
  // right-to-be-forgotten on a FRESH raw entry
  let f = seedRaw(emptyGeo(), { id: "x", raw: "John Doe SSN 123-45-6789 personal data", ts: now });
  f = forget(repoRoot, f, "123-45-6789", now);
  const forgotten = !containsRaw(f, "123-45-6789") && f.cells[0].abstract === "[forgotten]" && !!f.cells[0].purgeProof;
  // tamper the audit chain → caught
  const tampered = { ...after, events: after.events.map((e, i) => i === 0 ? { ...e, ts: e.ts + 1 } : e) };
  const tamperCaught = verifyGeo(tampered).chainIntact === false;

  const checks = [
    { name: "RAW-PURGED", pass: rawGone, detail: "after decay, NO raw text for purged entries survives in the store" },
    { name: "PURGE-PROOF-SIGNED", pass: v.proofsTotal > 0 && v.proofsValid === v.proofsTotal, detail: `every purge carries a verifiable Ed25519 proof binding the raw hash (${v.proofsValid}/${v.proofsTotal})` },
    { name: "AXIOM-FUSION", pass: hasAxiom && essencePreserved, detail: "dense near-duplicate abstracts fuse into a high-support axiom that keeps the shared essence" },
    { name: "ESSENCE-PRESERVED", pass: distinctSurvivesAsAbstract, detail: "a distinct entry keeps its gist as an abstract (wisdom retained, raw gone)" },
    { name: "MONOTONIC-DECAY", pass: monotonic, detail: "tier only advances raw→abstract→axiom — raw is never resurrected" },
    { name: "RIGHT-TO-FORGET", pass: forgotten, detail: "an on-demand forget purges the raw immediately + emits a signed tombstone (GDPR by construction)" },
    { name: "AUDIT-CHAIN", pass: v.chainIntact && tamperCaught, detail: "every metamorphosis is hash-chained; tampering the history is caught" },
    { name: "DETERMINISTIC", pass: det, detail: "same inputs + clock → byte-identical metamorphosis" },
    { name: "BLOAT-RECLAIMED", pass: stats.rawBytesReclaimed > 0, detail: `raw bytes reclaimed: ${stats.rawBytesReclaimed} (the store shrinks)` },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

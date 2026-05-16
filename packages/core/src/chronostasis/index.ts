/**
 * v2.19.5 — MNEME CHRONOSTASIS · FLAGSHIP · Time-Locked Provable Memory
 *
 *   "Every claim Mneme makes starts as PENDING. It must survive a
 *    `deadlineMs` adversarial window during which any witness AI can
 *    refute it with evidence. If a verdict comes back with refute=true
 *    + confidence ≥ rewindThreshold, the dependency graph is walked
 *    and EVERY downstream pending claim is deprecated — Mneme can
 *    unsay its past automatically. If the deadline passes with no
 *    valid refute, the claim CRYSTALLIZES into an immutable axiom.
 *    Axioms gravitationally attract related future queries (jaccard
 *    similarity) and are returned as 'these have been time-tested'.
 *
 *    No AI vendor on Earth ships a primitive that AUTOMATICALLY
 *    rewinds its own history when adversarial witnesses disagree.
 *    Mneme is the first."
 *
 * Five phases (all in this file; ~one source of truth):
 *   Phase 1  proposeClaim     wrap → pending; HMAC + dep-graph indexed
 *   Phase 2  recordVerdict    witness vendor adds refute / not-refute + conf
 *   Phase 3  tick → REWIND    refuted with conf≥0.7 → deprecate dep cascade
 *   Phase 4  tick → CRYSTAL.  deadline passed + all deps are axioms → axiom
 *   Phase 5  truthGravity     similarity over body text → ranked axioms
 *
 * Honest scope:
 *   - CHRONOSTASIS is the orchestrator + signed-storage layer. It does
 *     NOT call AI vendors itself. The caller fans out witness prompts
 *     to any vendors of choice (Claude / GPT / Gemini / Grok / Cursor /
 *     Codex / etc.) and pipes verdicts back via recordVerdict().
 *   - Axioms are immutable. Once crystallized, they can never be refuted.
 *     This is intentional: it enforces "time-tested" semantics. If new
 *     evidence emerges later, propose a new pending claim that depends
 *     on the contradiction; the system will reckon with it.
 *   - REWIND cascades only through PENDING claims. Axioms never deprecate.
 *     Crystallization gate enforces all-dependencies-are-axioms first.
 *   - Truth gravity uses lexical jaccard (portable, no deps). Replace
 *     with embeddings in a future release if higher fidelity is needed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_REWIND_THRESHOLD = 0.7;

export type ClaimStatus = "pending" | "deprecated" | "axiom";

export interface PendingClaim {
  v: typeof PROTOCOL_VERSION;
  claimId: string;
  body: string;
  /** Optional structured context (e.g., source file, function name, vendor). */
  context: Record<string, unknown>;
  /** Wall-clock deadline; after this, claim crystallizes if not refuted. */
  deadlineAt: string;
  proposedAt: string;
  /** Vendors to fan out witness prompts to (advisory; caller may use other set). */
  witnessPool: string[];
  /** Claim IDs this depends on (must all be axioms to crystallize). */
  dependsOn: string[];
  /** Chain link — sig of prior pending claim (genesis if first). */
  prevSig: string;
  sig: string;
}

export interface WitnessVerdict {
  v: typeof PROTOCOL_VERSION;
  verdictId: string;
  claimId: string;
  vendor: string;
  refuted: boolean;
  evidence: string;
  /** 0..1; only refutes with confidence ≥ rewindThreshold trigger REWIND. */
  confidence: number;
  ts: string;
  sig: string;
}

export interface Axiom {
  v: typeof PROTOCOL_VERSION;
  axiomId: string;
  body: string;
  context: Record<string, unknown>;
  promotedFromClaimId: string;
  promotedAt: string;
  /** How long the claim survived as pending before crystallization. */
  crystallizedAfterMs: number;
  /** Axioms it depends on. */
  dependsOn: string[];
  prevSig: string;
  sig: string;
}

export interface RewindRecord {
  v: typeof PROTOCOL_VERSION;
  rewindId: string;
  triggeredByClaimId: string;
  triggeredByVerdictId: string;
  /** All pending claims that were marked deprecated (transitive). */
  deprecatedClaimIds: string[];
  rewoundAt: string;
  reason: string;
  sig: string;
}

export interface TickResult {
  rewinds: RewindRecord[];
  crystallized: Axiom[];
  stillPending: number;
  deprecatedSoFar: number;
}

export interface GravityResult {
  v: typeof PROTOCOL_VERSION;
  queryText: string;
  attractedAxioms: Array<{ axiomId: string; similarity: number; body: string }>;
  builtAt: string;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "it", "to", "of", "in", "on",
  "for", "with", "as", "at", "by", "this", "that", "be", "you", "i", "we",
  "they", "are", "was", "were", "have", "has", "had", "do", "does", "did",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => !STOP.has(t) && t.length >= 2);
}

function jaccardSim(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CHRONOSTASIS_SECRET"] || `mneme-chronostasis-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

const GENESIS_SIG = "genesis".padEnd(64, "0");

export interface ChronostasisOptions {
  pendingPath?: string;
  verdictsPath?: string;
  axiomsPath?: string;
  rewindsPath?: string;
  secret?: string;
  rewindThreshold?: number;
}

export class Chronostasis {
  private pendingPath: string;
  private verdictsPath: string;
  private axiomsPath: string;
  private rewindsPath: string;
  private secret: string;
  private rewindThreshold: number;

  private pending: Map<string, PendingClaim> = new Map();
  private verdicts: Map<string, WitnessVerdict[]> = new Map(); // claimId → verdicts
  private axioms: Axiom[] = [];
  private rewinds: RewindRecord[] = [];
  private deprecated: Set<string> = new Set();
  /** Reverse index: for each claim, the set of pending claims depending on it. */
  private dependents: Map<string, Set<string>> = new Map();
  /** Append-only ordered list of all pending IDs ever proposed (for chain). */
  private pendingChainOrder: string[] = [];

  constructor(opts: ChronostasisOptions = {}) {
    this.pendingPath = opts.pendingPath ?? ".mneme/chronostasis/pending.jsonl";
    this.verdictsPath = opts.verdictsPath ?? ".mneme/chronostasis/verdicts.jsonl";
    this.axiomsPath = opts.axiomsPath ?? ".mneme/chronostasis/axioms.jsonl";
    this.rewindsPath = opts.rewindsPath ?? ".mneme/chronostasis/rewinds.jsonl";
    this.secret = opts.secret ?? defaultSecret();
    this.rewindThreshold = opts.rewindThreshold ?? DEFAULT_REWIND_THRESHOLD;
    this.loadIfExists();
  }

  private loadIfExists(): void {
    const readJsonl = <T>(p: string): T[] => {
      if (!existsSync(p)) return [];
      const text = readFileSync(p, "utf8");
      const out: T[] = [];
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { out.push(JSON.parse(t) as T); } catch { /* skip */ }
      }
      return out;
    };
    for (const c of readJsonl<PendingClaim>(this.pendingPath)) {
      this.pending.set(c.claimId, c);
      this.pendingChainOrder.push(c.claimId);
      for (const dep of c.dependsOn) {
        let s = this.dependents.get(dep);
        if (!s) { s = new Set(); this.dependents.set(dep, s); }
        s.add(c.claimId);
      }
    }
    for (const v of readJsonl<WitnessVerdict>(this.verdictsPath)) {
      const list = this.verdicts.get(v.claimId) ?? [];
      list.push(v);
      this.verdicts.set(v.claimId, list);
    }
    this.axioms.push(...readJsonl<Axiom>(this.axiomsPath));
    this.rewinds.push(...readJsonl<RewindRecord>(this.rewindsPath));
    // Reconstruct deprecated set
    for (const r of this.rewinds) for (const id of r.deprecatedClaimIds) this.deprecated.add(id);
  }

  // ── Phase 1: propose ────────────────────────────────────────────────
  proposeClaim(input: {
    body: string;
    context?: Record<string, unknown>;
    deadlineSec?: number;
    witnessPool?: string[];
    dependsOn?: string[];
    nowMs?: number;
  }): PendingClaim {
    const now = input.nowMs ?? Date.now();
    const deadlineSec = input.deadlineSec ?? 600;
    const proposedAt = new Date(now).toISOString();
    const deadlineAt = new Date(now + deadlineSec * 1000).toISOString();
    const witnessPool = input.witnessPool ?? ["claude", "chatgpt", "gemini", "grok", "perplexity"];
    const dependsOn = (input.dependsOn ?? []).slice();
    // Validate dependsOn exist as axiom or pending.
    // CHECK DEPRECATED FIRST — once deprecated, the claim leaves `pending` so the
    // "unknown" branch would fire first if we don't short-circuit here.
    for (const dep of dependsOn) {
      if (this.deprecated.has(dep)) {
        throw new Error(`CHRONOSTASIS: cannot depend on deprecated claim '${dep}'`);
      }
      const isAxiom = this.axioms.some((a) => a.axiomId === dep || a.promotedFromClaimId === dep);
      if (!this.pending.has(dep) && !isAxiom) {
        throw new Error(`CHRONOSTASIS: dependsOn references unknown claim/axiom '${dep}'`);
      }
    }
    const prevSig = this.pendingChainOrder.length === 0
      ? GENESIS_SIG
      : this.pending.get(this.pendingChainOrder[this.pendingChainOrder.length - 1]!)!.sig;
    const claimId = "pc-" + createHmac("sha256", "mneme-chrono-claim-id")
      .update(`${proposedAt}|${input.body.slice(0, 80)}|${this.pendingChainOrder.length}`)
      .digest("hex").slice(0, 14);

    const body: Omit<PendingClaim, "sig"> = {
      v: PROTOCOL_VERSION,
      claimId,
      body: input.body,
      context: input.context ?? {},
      deadlineAt,
      proposedAt,
      witnessPool,
      dependsOn,
      prevSig,
    };
    const sig = hmac(body, this.secret);
    const claim: PendingClaim = { ...body, sig };

    this.pending.set(claimId, claim);
    this.pendingChainOrder.push(claimId);
    for (const dep of dependsOn) {
      let s = this.dependents.get(dep);
      if (!s) { s = new Set(); this.dependents.set(dep, s); }
      s.add(claimId);
    }
    this.persistAppend(this.pendingPath, claim);
    return claim;
  }

  // ── Phase 2: witness ────────────────────────────────────────────────
  /** Build the meta-prompt the caller should send to a witness vendor. */
  buildWitnessPrompt(claim: PendingClaim, vendor: string): string {
    return [
      `You are an ADVERSARIAL WITNESS AI assigned to refute or confirm a Mneme claim.`,
      `Vendor identity: ${vendor}`,
      `Claim: """${claim.body}"""`,
      claim.context && Object.keys(claim.context).length ? `Context: ${JSON.stringify(claim.context)}` : "",
      ``,
      `Your job: search for counter-evidence in the available repo / git log / public ground truth.`,
      `If you find solid counter-evidence, return refuted=true with a brief evidence summary + confidence 0..1.`,
      `If the claim holds up, return refuted=false with confidence 0..1 (higher = more sure).`,
      ``,
      `Reply STRICTLY as JSON: { "refuted": <bool>, "evidence": "<string>", "confidence": <0..1> }`,
    ].filter(Boolean).join("\n");
  }

  recordVerdict(input: {
    claimId: string;
    vendor: string;
    refuted: boolean;
    evidence: string;
    confidence: number;
    nowMs?: number;
  }): WitnessVerdict {
    if (!this.pending.has(input.claimId)) {
      // Honest no-op semantics: if the claim already crystallized or got deprecated,
      // verdicts no longer apply. Throw so the caller knows to drop.
      throw new Error(`CHRONOSTASIS: claim '${input.claimId}' is no longer pending (axiom or deprecated)`);
    }
    if (input.confidence < 0 || input.confidence > 1) {
      throw new Error(`CHRONOSTASIS: confidence must be in [0,1]; got ${input.confidence}`);
    }
    const now = input.nowMs ?? Date.now();
    const ts = new Date(now).toISOString();
    const verdictId = "wv-" + createHmac("sha256", "mneme-chrono-verdict-id")
      .update(`${input.claimId}|${input.vendor}|${ts}`)
      .digest("hex").slice(0, 14);
    const body: Omit<WitnessVerdict, "sig"> = {
      v: PROTOCOL_VERSION,
      verdictId,
      claimId: input.claimId,
      vendor: input.vendor,
      refuted: input.refuted,
      evidence: input.evidence,
      confidence: input.confidence,
      ts,
    };
    const sig = hmac(body, this.secret);
    const verdict: WitnessVerdict = { ...body, sig };
    const list = this.verdicts.get(input.claimId) ?? [];
    list.push(verdict);
    this.verdicts.set(input.claimId, list);
    this.persistAppend(this.verdictsPath, verdict);
    return verdict;
  }

  // ── Phase 3 + 4: tick ───────────────────────────────────────────────
  tick(input: { nowMs?: number } = {}): TickResult {
    const now = input.nowMs ?? Date.now();
    const newRewinds: RewindRecord[] = [];
    const crystallized: Axiom[] = [];

    // Snapshot pending IDs at tick start (mutation during loop is fine; we iterate fixed list)
    const pendingIds = Array.from(this.pending.keys());

    for (const claimId of pendingIds) {
      if (!this.pending.has(claimId)) continue; // already processed/removed in this tick
      const claim = this.pending.get(claimId)!;
      if (this.deprecated.has(claimId)) continue;

      // Look for refute-with-high-confidence
      const verdicts = this.verdicts.get(claimId) ?? [];
      const refutes = verdicts.filter((v) => v.refuted && v.confidence >= this.rewindThreshold);
      if (refutes.length > 0) {
        const top = refutes.reduce((a, b) => (b.confidence > a.confidence ? b : a));
        const rec = this.doRewind(claimId, top, now);
        newRewinds.push(rec);
        continue;
      }

      // Otherwise check crystallization
      if (Date.parse(claim.deadlineAt) <= now) {
        // All dependsOn must be axioms (not pending, not deprecated).
        // dep references use the ORIGINAL pending claimId, so match against
        // axiom.promotedFromClaimId (or axiom.axiomId for axiom→axiom deps).
        const allDepsAxiom = claim.dependsOn.every((dep) =>
          this.axioms.some((a) => a.promotedFromClaimId === dep || a.axiomId === dep)
        );
        if (!allDepsAxiom) continue; // wait until deps crystallize first
        const ax = this.doCrystallize(claim, now);
        crystallized.push(ax);
      }
    }

    return {
      rewinds: newRewinds,
      crystallized,
      stillPending: this.pending.size,
      deprecatedSoFar: this.deprecated.size,
    };
  }

  private doRewind(triggerClaimId: string, verdict: WitnessVerdict, nowMs: number): RewindRecord {
    // Walk transitive dependents
    const toDeprecate = new Set<string>();
    const queue: string[] = [triggerClaimId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (toDeprecate.has(id)) continue;
      toDeprecate.add(id);
      const downs = this.dependents.get(id);
      if (downs) for (const d of downs) {
        if (this.pending.has(d) && !this.deprecated.has(d)) queue.push(d);
      }
    }
    // Apply: mark deprecated + remove from pending map (chain stays; just marked)
    for (const id of toDeprecate) {
      this.deprecated.add(id);
      this.pending.delete(id);
    }
    const rewindId = "rw-" + createHmac("sha256", "mneme-chrono-rewind-id")
      .update(`${triggerClaimId}|${verdict.verdictId}|${nowMs}`)
      .digest("hex").slice(0, 14);
    const body: Omit<RewindRecord, "sig"> = {
      v: PROTOCOL_VERSION,
      rewindId,
      triggeredByClaimId: triggerClaimId,
      triggeredByVerdictId: verdict.verdictId,
      deprecatedClaimIds: Array.from(toDeprecate),
      rewoundAt: new Date(nowMs).toISOString(),
      reason: `vendor=${verdict.vendor} confidence=${verdict.confidence} evidence="${verdict.evidence.slice(0, 120)}"`,
    };
    const sig = hmac(body, this.secret);
    const rec: RewindRecord = { ...body, sig };
    this.rewinds.push(rec);
    this.persistAppend(this.rewindsPath, rec);
    return rec;
  }

  private doCrystallize(claim: PendingClaim, nowMs: number): Axiom {
    const promotedAt = new Date(nowMs).toISOString();
    const crystallizedAfterMs = nowMs - Date.parse(claim.proposedAt);
    const prevSig = this.axioms.length === 0 ? GENESIS_SIG : this.axioms[this.axioms.length - 1]!.sig;
    const axiomId = "ax-" + createHmac("sha256", "mneme-chrono-axiom-id")
      .update(`${claim.claimId}|${promotedAt}`)
      .digest("hex").slice(0, 14);
    const body: Omit<Axiom, "sig"> = {
      v: PROTOCOL_VERSION,
      axiomId,
      body: claim.body,
      context: claim.context,
      promotedFromClaimId: claim.claimId,
      promotedAt,
      crystallizedAfterMs,
      dependsOn: claim.dependsOn.slice(),
      prevSig,
    };
    const sig = hmac(body, this.secret);
    const ax: Axiom = { ...body, sig };
    this.axioms.push(ax);
    this.persistAppend(this.axiomsPath, ax);
    this.pending.delete(claim.claimId);
    return ax;
  }

  // ── Phase 5: truth gravity ──────────────────────────────────────────
  axiomsRelevantTo(input: { queryText: string; k?: number; minSimilarity?: number }): GravityResult {
    const k = input.k ?? 5;
    const minSim = input.minSimilarity ?? 0.1;
    const ranked = this.axioms
      .map((a) => ({ axiomId: a.axiomId, body: a.body, similarity: Math.round(jaccardSim(input.queryText, a.body) * 1000) / 1000 }))
      .filter((r) => r.similarity >= minSim)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    return {
      v: PROTOCOL_VERSION,
      queryText: input.queryText,
      attractedAxioms: ranked,
      builtAt: new Date().toISOString(),
    };
  }

  // ── Verification / introspection ────────────────────────────────────
  verifyClaim(c: PendingClaim): boolean {
    const { sig, ...body } = c;
    return safeEqHex(hmac(body, this.secret), sig);
  }
  verifyVerdict(v: WitnessVerdict): boolean {
    const { sig, ...body } = v;
    return safeEqHex(hmac(body, this.secret), sig);
  }
  verifyAxiom(a: Axiom): boolean {
    const { sig, ...body } = a;
    return safeEqHex(hmac(body, this.secret), sig);
  }
  verifyRewind(r: RewindRecord): boolean {
    const { sig, ...body } = r;
    return safeEqHex(hmac(body, this.secret), sig);
  }
  /** Verify the pending claim chain + axiom chain integrity. */
  verifyChain(): { ok: boolean; brokenAt?: string; reason?: string } {
    // Pending chain (in propose order)
    for (let i = 0; i < this.pendingChainOrder.length; i++) {
      const id = this.pendingChainOrder[i]!;
      const c = this.pending.get(id);
      if (!c) continue; // crystallized / deprecated — skip
      if (!this.verifyClaim(c)) return { ok: false, brokenAt: id, reason: "pending sig mismatch" };
      if (i === 0) {
        if (c.prevSig !== GENESIS_SIG) return { ok: false, brokenAt: id, reason: "pending genesis wrong" };
      } else {
        // walk back to find the previous still-present (or original chain) sig
        // For simplicity, require the immediately-previous pending in chain order.
        const prevId = this.pendingChainOrder[i - 1]!;
        const prev = this.pending.get(prevId);
        // Skip prevSig check when previous claim has been removed (deprecated/axiom).
        if (prev && c.prevSig !== prev.sig) return { ok: false, brokenAt: id, reason: "pending chain link mismatch" };
      }
    }
    // Axiom chain
    for (let i = 0; i < this.axioms.length; i++) {
      const ax = this.axioms[i]!;
      if (!this.verifyAxiom(ax)) return { ok: false, brokenAt: ax.axiomId, reason: "axiom sig mismatch" };
      if (i === 0) {
        if (ax.prevSig !== GENESIS_SIG) return { ok: false, brokenAt: ax.axiomId, reason: "axiom genesis wrong" };
      } else {
        const prev = this.axioms[i - 1]!;
        if (ax.prevSig !== prev.sig) return { ok: false, brokenAt: ax.axiomId, reason: "axiom chain link mismatch" };
      }
    }
    return { ok: true };
  }

  summary(): {
    pendingCount: number;
    axiomCount: number;
    deprecatedCount: number;
    rewindCount: number;
    verdictCount: number;
    chainOk: boolean;
  } {
    let vc = 0;
    for (const list of this.verdicts.values()) vc += list.length;
    return {
      pendingCount: this.pending.size,
      axiomCount: this.axioms.length,
      deprecatedCount: this.deprecated.size,
      rewindCount: this.rewinds.length,
      verdictCount: vc,
      chainOk: this.verifyChain().ok,
    };
  }

  status(claimId: string): ClaimStatus {
    if (this.deprecated.has(claimId)) return "deprecated";
    if (this.pending.has(claimId)) return "pending";
    if (this.axioms.some((a) => a.promotedFromClaimId === claimId || a.axiomId === claimId)) return "axiom";
    return "pending"; // unknown → treat as not-yet-present-but-pending
  }

  /** Read-only views for inspection / testing. */
  exportPending(): PendingClaim[] { return Array.from(this.pending.values()); }
  exportAxioms(): Axiom[] { return this.axioms.slice(); }
  exportRewinds(): RewindRecord[] { return this.rewinds.slice(); }
  exportVerdicts(claimId: string): WitnessVerdict[] { return (this.verdicts.get(claimId) ?? []).slice(); }

  // ── Persistence ─────────────────────────────────────────────────────
  private persistAppend(path: string, record: unknown): void {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const line = JSON.stringify(record) + "\n";
      if (existsSync(path)) {
        const cur = readFileSync(path, "utf8");
        writeFileSync(path, cur + line, "utf8");
      } else {
        writeFileSync(path, line, "utf8");
      }
    } catch { /* best-effort */ }
  }
}

export function formatClaimLine(c: PendingClaim): string {
  return `⏳ PENDING · ${c.claimId} · deadline ${c.deadlineAt.slice(11, 19)} · ${c.body.slice(0, 60)}`;
}
export function formatAxiomLine(a: Axiom): string {
  return `🪐 AXIOM · ${a.axiomId} · survived ${Math.round(a.crystallizedAfterMs / 1000)}s · ${a.body.slice(0, 60)}`;
}
export function formatRewindLine(r: RewindRecord): string {
  return `↩️ REWIND · ${r.rewindId} · ${r.deprecatedClaimIds.length} claim(s) deprecated · ${r.reason.slice(0, 80)}`;
}

/** Process-local singleton. */
let _instance: Chronostasis | null = null;
export function defaultChronostasis(): Chronostasis {
  if (!_instance) _instance = new Chronostasis();
  return _instance;
}

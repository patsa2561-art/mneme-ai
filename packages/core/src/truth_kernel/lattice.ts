/**
 * v2.89.0 — 💎 THE AXIOM LATTICE · ALETHEIA's living proof graph.
 *
 * The savant doesn't just answer one claim and forget it (that was v2.88). A real
 * savant — Padgett "sees frames connected by lines", never forgets, and CANNOT
 * hold two opposing truths. The Axiom Lattice is that faculty made real: a
 * persistent, hash-chained, Ed25519-signed graph of every assertion ALETHEIA has
 * made — offline-verifiable, tamper-evident, self-correcting.
 *
 * It realises three savant axes + two vows at once:
 *   • Graph perception   — claims are nodes; lineage + dependency are edges.
 *   • Anti-abstraction   — lossless: the exact claim + verdict + proof, never summarised away.
 *   • Proof, not belief  — `whyTrue` walks the lineage back to bedrock (deterministic) sensors.
 *   • Never Forget       — append-only, hash-chained, signed; retrievable forever.
 *   • Trust Nothing      — `verifyLattice` re-verifies every node + the chain, OFFLINE.
 *
 * Two superhuman behaviours no LLM can do structurally:
 *   1. CONTRADICTION DETECTION — recording a claim that opposes an existing TRUE
 *      surfaces the conflict as the LOUDEST signal (the savant can't hold both).
 *   2. RETRACTION CASCADE (truth-maintenance) — when a claim is refuted, every
 *      claim that DEPENDED on it is automatically marked PENDING_REVERIFY + a
 *      signed retraction frame is written. Change one fact → the multiverse knows.
 *
 * Built on NOTARY (signing/chain) — no new crypto. Never throws.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/index.js";
import type { AletheiaVerdict } from "./aletheia.js";

export type NodeStatus = "ACTIVE" | "RETRACTED" | "PENDING_REVERIFY";

export interface LatticeNode {
  /** Stable id = sha256(seq|claim|verdict)[:16]. */
  id: string;
  seq: number;
  claim: string;
  /** Normalised subject for clustering + contradiction detection. */
  subject: string;
  verdict: AletheiaVerdict;
  pTrue: number;
  /** Sensor ids that drove the verdict (the proof). */
  lineageSummary: string[];
  /** Ids of other lattice nodes this claim's truth rests on (truth-maintenance edges). */
  dependsOn: string[];
  status: NodeStatus;
  at: number;
  /** Previous node's receiptId — the hash chain. */
  prev: string | null;
  /** The full NOTARY receipt (signature over the claim+verdict payload). null only
   *  if signing degraded. Embedded so the lattice verifies OFFLINE + editing the
   *  node body is detectable against the signed payload. */
  receipt: NotaryReceipt | null;
}

export interface Contradiction {
  kind: "opposite-verdict" | "negation-pair" | "value-conflict";
  /** Existing node id. */
  existing: string;
  /** The incoming claim text. */
  incoming: string;
  detail: string;
}

const NEG_RE = /\b(not|isn't|aren't|never|no longer|doesn't|don't|won't|cannot|can't)\b|ไม่ใช่|ไม่ได้|ไม่/i;
const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on", "at", "by", "for", "with", "and", "or", "it", "this", "that", "=", "==", "equals", "เป็น", "คือ", "ที่", "ใน"]);

/** Normalise a claim's SUBJECT: lowercase, strip negation + values + stopwords,
 *  token-sort. Two claims about the same thing collapse to the same key, so a
 *  contradiction (same subject, opposing verdict/value) becomes detectable. */
export function normalizeSubject(claim: string): string {
  const c = String(claim ?? "").toLowerCase();
  const head = c.split(/\s*(?:=|==|\bis\b|\bare\b|\bequals\b|\bคือ\b|\bเป็น\b)\s*/)[0] ?? c;
  const tokens = head
    .replace(NEG_RE, " ")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

/** Extract the VALUE side of a "subject <copula> value" claim (for value-conflict). */
function extractValue(claim: string): string | null {
  const m = /(?:=|==|\bis\b|\bare\b|\bequals\b|\bคือ\b|\bเป็น\b)\s*(.+)$/i.exec(String(claim ?? ""));
  if (!m) return null;
  return m[1]!.trim().toLowerCase().replace(/[.;]+$/, "");
}

function hasNegation(claim: string): boolean {
  return NEG_RE.test(String(claim ?? ""));
}

function latticeDir(repoRoot: string): string { return join(repoRoot, ".mneme", "aletheia"); }
function latticePath(repoRoot: string): string { return join(latticeDir(repoRoot), "lattice.jsonl"); }

/** Read every lattice node. Never throws — a corrupt line is skipped. */
export function readLattice(repoRoot: string): LatticeNode[] {
  try {
    const p = latticePath(repoRoot);
    if (!existsSync(p)) return [];
    const out: LatticeNode[] = [];
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s) as LatticeNode); } catch { /* skip corrupt */ }
    }
    return out;
  } catch { return []; }
}

function writeAll(repoRoot: string, nodes: LatticeNode[]): void {
  mkdirSync(latticeDir(repoRoot), { recursive: true });
  writeFileSync(latticePath(repoRoot), nodes.map((n) => JSON.stringify(n)).join("\n") + (nodes.length ? "\n" : ""), "utf8");
}

/**
 * Detect contradictions between an incoming (claim, verdict) and the ACTIVE
 * nodes already in the lattice. Three modes, strongest first. Never throws.
 */
export function detectContradictions(repoRoot: string, claim: string, verdict: AletheiaVerdict): Contradiction[] {
  const out: Contradiction[] = [];
  if (verdict === "UNKNOWN") return out; // UNKNOWN asserts nothing → can't contradict
  const subj = normalizeSubject(claim);
  if (!subj) return out;
  const incNeg = hasNegation(claim);
  const incVal = extractValue(claim);
  for (const n of readLattice(repoRoot)) {
    if (n.status !== "ACTIVE" || n.verdict === "UNKNOWN") continue;
    if (n.subject !== subj) continue;
    // (1) opposite-verdict on the same subject: one TRUE, one FALSE.
    if (n.verdict !== verdict) {
      out.push({ kind: "opposite-verdict", existing: n.id, incoming: claim, detail: `"${n.claim}" is ${n.verdict} but "${claim}" is ${verdict}` });
      continue;
    }
    // Both assert the SAME polarity (e.g. both TRUE) on the same subject — look for
    // a semantic conflict that two co-true claims cannot both hold.
    if (verdict === "TRUE") {
      // (2) negation-pair: one says X, the other says NOT X — both can't be true.
      if (incNeg !== hasNegation(n.claim)) {
        out.push({ kind: "negation-pair", existing: n.id, incoming: claim, detail: `"${n.claim}" and "${claim}" assert opposite polarity of the same subject` });
        continue;
      }
      // (3) value-conflict: same subject "= value", different values — both can't be true.
      const exVal = extractValue(n.claim);
      if (incVal && exVal && incVal !== exVal) {
        out.push({ kind: "value-conflict", existing: n.id, incoming: claim, detail: `subject resolves to "${exVal}" and "${incVal}" — mutually exclusive` });
      }
    }
  }
  return out;
}

export interface RecordInput {
  claim: string;
  verdict: AletheiaVerdict;
  pTrue: number;
  /** Sensor ids that drove the verdict. */
  lineageSummary?: string[];
}

export interface RecordResult {
  node: LatticeNode;
  contradictions: Contradiction[];
}

/**
 * Append a signed, hash-chained node to the lattice. Detects contradictions vs
 * the existing ACTIVE truths FIRST (the loudest signal) and returns them.
 * Lossless (Refusal 2). Never throws — degrades to an unsigned node if NOTARY fails.
 */
export function recordAssertion(repoRoot: string, input: RecordInput, opts: { dependsOn?: string[]; issuedAt?: number; now?: number } = {}): RecordResult {
  const claim = String(input.claim ?? "");
  const verdict = input.verdict;
  const contradictions = detectContradictions(repoRoot, claim, verdict);
  const existing = readLattice(repoRoot);
  const seq = existing.length;
  const last = existing[existing.length - 1];
  const prev = last ? (last.receipt?.receiptId ?? last.id) : null;
  const id = createHash("sha256").update(`${seq}|${claim}|${verdict}`).digest("hex").slice(0, 16);
  const at = opts.now ?? opts.issuedAt ?? Date.now();
  let receipt: NotaryReceipt | null = null;
  try {
    receipt = issueReceipt(repoRoot, {
      kind: "claim-verdict",
      subject: id,
      payload: { engine: "aletheia-lattice", seq, claim, verdict, pTrue: input.pTrue, dependsOn: opts.dependsOn ?? [] },
      prev,
      issuedAt: opts.issuedAt ?? at,
    });
  } catch { receipt = null; }
  const node: LatticeNode = {
    id, seq, claim, subject: normalizeSubject(claim), verdict, pTrue: input.pTrue,
    lineageSummary: input.lineageSummary ?? [], dependsOn: opts.dependsOn ?? [],
    status: "ACTIVE", at, prev, receipt,
  };
  try {
    mkdirSync(latticeDir(repoRoot), { recursive: true });
    appendFileSync(latticePath(repoRoot), JSON.stringify(node) + "\n", "utf8");
  } catch { /* best-effort persistence */ }
  return { node, contradictions };
}

export interface WhyResult {
  found: boolean;
  node?: LatticeNode;
  /** Human-readable proof path: this claim ← its sensors / dependency claims ← bedrock. */
  proof: string[];
}

/** Walk the proof of a claim: its lineage (sensors) + its dependency nodes, back
 *  toward bedrock (deterministic sensors like `arithmetic` are axioms). Never throws. */
export function whyTrue(repoRoot: string, claimOrId: string): WhyResult {
  const nodes = readLattice(repoRoot);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const target = byId.get(claimOrId) ?? [...nodes].reverse().find((n) => n.claim === claimOrId);
  if (!target) return { found: false, proof: [] };
  const proof: string[] = [];
  const seen = new Set<string>();
  const walk = (n: LatticeNode, depth: number): void => {
    if (seen.has(n.id)) { proof.push(`${"  ".repeat(depth)}↺ (already shown) ${n.claim}`); return; }
    seen.add(n.id);
    const bedrock = n.lineageSummary.includes("arithmetic") ? " [bedrock: deterministic]" : "";
    const sig = n.receipt ? "(signed)" : "(unsigned)";
    const mark = n.verdict === "TRUE" ? "✓" : n.verdict === "FALSE" ? "✗" : "?";
    proof.push(`${"  ".repeat(depth)}${mark} ${n.claim} — via ${n.lineageSummary.join("+") || "?"}${bedrock} ${sig}`);
    for (const dep of n.dependsOn) {
      const d = byId.get(dep);
      if (d) walk(d, depth + 1);
      else proof.push(`${"  ".repeat(depth + 1)}⚠ missing dependency ${dep}`);
    }
  };
  walk(target, 0);
  return { found: true, node: target, proof };
}

export interface RetractResult {
  retracted: string[];
  /** Node ids marked PENDING_REVERIFY because they depended on a retracted node. */
  cascade: string[];
  retractionReceiptId: string | null;
}

/**
 * Retract a claim and CASCADE: every ACTIVE node that (transitively) depended on
 * it is marked PENDING_REVERIFY — its proof rested on a now-refuted fact, so it
 * must be re-verified before it can be trusted again. Writes a signed retraction
 * frame. The truth-maintenance heart of the savant. Never throws.
 */
export function retract(repoRoot: string, claimOrId: string, reason: string, opts: { issuedAt?: number } = {}): RetractResult {
  const nodes = readLattice(repoRoot);
  const target = nodes.find((n) => n.id === claimOrId) ?? [...nodes].reverse().find((n) => n.claim === claimOrId && n.status === "ACTIVE");
  if (!target) return { retracted: [], cascade: [], retractionReceiptId: null };

  const retracted: string[] = [];
  const cascade: string[] = [];
  target.status = "RETRACTED";
  retracted.push(target.id);

  // BFS over dependents (nodes whose dependsOn includes a retracted/pending id).
  let frontier = new Set<string>([target.id]);
  for (let guard = 0; guard < nodes.length + 1 && frontier.size; guard++) {
    const next = new Set<string>();
    for (const n of nodes) {
      if (n.status !== "ACTIVE") continue;
      if (n.dependsOn.some((d) => frontier.has(d))) {
        n.status = "PENDING_REVERIFY";
        cascade.push(n.id);
        next.add(n.id);
      }
    }
    frontier = next;
  }

  let retractionReceiptId: string | null = null;
  try {
    const r = issueReceipt(repoRoot, {
      kind: "claim-verdict",
      subject: `retract:${target.id}`,
      payload: { engine: "aletheia-lattice", action: "retract", target: target.id, reason, cascade },
      issuedAt: opts.issuedAt,
    });
    retractionReceiptId = r.receiptId;
  } catch { retractionReceiptId = null; }

  writeAll(repoRoot, nodes);
  return { retracted, cascade, retractionReceiptId };
}

export interface LatticeStatus {
  nodes: number;
  active: number;
  retracted: number;
  pending: number;
  openContradictions: number;
  chainValid: boolean;
}

/** Live lattice status: counts + open contradictions among ACTIVE truths + chain integrity. */
export function latticeStatus(repoRoot: string): LatticeStatus {
  const nodes = readLattice(repoRoot);
  let active = 0, retracted = 0, pending = 0;
  for (const n of nodes) {
    if (n.status === "ACTIVE") active++;
    else if (n.status === "RETRACTED") retracted++;
    else pending++;
  }
  let open = 0;
  const activeNodes = nodes.filter((n) => n.status === "ACTIVE" && n.verdict !== "UNKNOWN");
  for (let i = 0; i < activeNodes.length; i++) {
    for (let j = i + 1; j < activeNodes.length; j++) {
      const a = activeNodes[i]!, b = activeNodes[j]!;
      if (a.subject !== b.subject) continue;
      if (a.verdict !== b.verdict) { open++; continue; }
      if (a.verdict === "TRUE") {
        if (hasNegation(a.claim) !== hasNegation(b.claim)) { open++; continue; }
        const va = extractValue(a.claim), vb = extractValue(b.claim);
        if (va && vb && va !== vb) open++;
      }
    }
  }
  return { nodes: nodes.length, active, retracted, pending, openContradictions: open, chainValid: verifyLattice(repoRoot).ok };
}

export interface VerifyLatticeResult {
  ok: boolean;
  nodes: number;
  /** seq of the first broken link, if any. */
  brokenAt?: number;
  /** node ids whose NOTARY signature failed, OR whose body was tampered vs the signed payload. */
  badSignatures: string[];
}

/**
 * Re-verify the entire lattice OFFLINE: for every signed node (1) its NOTARY
 * receipt's Ed25519 signature is valid, (2) the node's claim/verdict MATCH the
 * signed payload (so editing the jsonl body is caught), and (3) each node's
 * `prev` matches the predecessor's receiptId (the chain is intact). This is the
 * savant's "Trust Nothing — including itself". Never throws.
 */
export function verifyLattice(repoRoot: string): VerifyLatticeResult {
  const nodes = readLattice(repoRoot);
  const badSignatures: string[] = [];
  let prevReceipt: string | null = null;
  for (const n of nodes) {
    // (3) chain continuity
    if (n.prev !== prevReceipt) {
      return { ok: false, nodes: nodes.length, brokenAt: n.seq, badSignatures };
    }
    if (n.receipt) {
      // (1) signature valid
      let sigOk = false;
      try { sigOk = verifyReceipt(n.receipt).valid; } catch { sigOk = false; }
      // (2) node body matches the signed payload (tamper detection)
      const pl = (n.receipt.payload ?? {}) as { claim?: string; verdict?: string };
      const bodyMatches = pl.claim === n.claim && pl.verdict === n.verdict;
      if (!sigOk || !bodyMatches) badSignatures.push(n.id);
      prevReceipt = n.receipt.receiptId;
    } else {
      prevReceipt = n.id;
    }
  }
  return { ok: badSignatures.length === 0, nodes: nodes.length, badSignatures };
}

/**
 * v2.90.0 — 💎⑤ CROSS-AGENT TRUTH MESH · the multiverse truth substrate.
 *
 * One savant's Axiom Lattice is a private brain. The Truth Mesh lets MANY savants
 * (across vendors, machines, agents) share PROVEN truths without a central server:
 * each exports a SIGNED bundle of its ACTIVE truths; a peer MERGES it after
 * verifying every signature offline — adding non-conflicting truths, DROPPING
 * forged/invalid ones, and SURFACING (never silently resolving) any truth that
 * CONTRADICTS what the peer already holds. CRDT-style: commutative + idempotent
 * (re-merging the same bundle changes nothing). Never throws.
 *
 * This is how the savant becomes the backbone of the AI multiverse: a tamper-evident,
 * vendor-neutral, offline-verifiable fabric of facts that compounds as more agents join.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/index.js";
import { readLattice, recordAssertion, detectContradictions } from "./lattice.js";
import type { AletheiaVerdict } from "./aletheia.js";

export interface MeshTruth {
  claim: string;
  subject: string;
  verdict: AletheiaVerdict;
  pTrue: number;
  /** Per-truth signature (so a single truth is verifiable in isolation). */
  receipt: NotaryReceipt | null;
}

export interface TruthBundle {
  v: 1;
  /** Who exported it (opaque agent id). */
  agent: string;
  truths: MeshTruth[];
  /** Signature over the whole bundle. */
  receipt: NotaryReceipt | null;
}

/** Export this savant's ACTIVE truths as a signed, portable bundle. Never throws. */
export function exportTruths(repoRoot: string, agent: string, opts: { issuedAt?: number } = {}): TruthBundle {
  const active = readLattice(repoRoot).filter((n) => n.status === "ACTIVE" && (n.verdict === "TRUE" || n.verdict === "FALSE"));
  const truths: MeshTruth[] = active.map((n) => ({ claim: n.claim, subject: n.subject, verdict: n.verdict, pTrue: n.pTrue, receipt: n.receipt }));
  let receipt: NotaryReceipt | null = null;
  try {
    receipt = issueReceipt(repoRoot, {
      kind: "memory-capsule",
      subject: `truth-bundle:${String(agent ?? "anon")}:${truths.length}`,
      payload: { engine: "aletheia-mesh", agent, truths: truths.map((t) => ({ claim: t.claim, verdict: t.verdict })) },
      issuedAt: opts.issuedAt,
    });
  } catch { receipt = null; }
  return { v: 1, agent: String(agent ?? "anon"), truths, receipt };
}

export interface MergeResult {
  /** Truths added to the local lattice. */
  added: number;
  /** Truths skipped because already present (idempotence). */
  duplicate: number;
  /** Truths dropped because their signature was missing/invalid (forgery defense). */
  rejectedUnsigned: number;
  /** Truths that CONTRADICT a local ACTIVE truth — surfaced, NOT merged. */
  conflicts: Array<{ claim: string; verdict: AletheiaVerdict; against: string }>;
  /** True iff the incoming bundle's own signature verified. */
  bundleVerified: boolean;
  summary: string;
}

function meshSeenPath(repoRoot: string): string { return join(repoRoot, ".mneme", "aletheia", "mesh-seen.json"); }
function loadSeen(repoRoot: string): Set<string> {
  try {
    const p = meshSeenPath(repoRoot);
    if (!existsSync(p)) return new Set();
    const arr = JSON.parse(readFileSync(p, "utf8")) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveSeen(repoRoot: string, seen: Set<string>): void {
  try { mkdirSync(join(repoRoot, ".mneme", "aletheia"), { recursive: true }); writeFileSync(meshSeenPath(repoRoot), JSON.stringify([...seen]), "utf8"); } catch { /* best-effort */ }
}
function truthKey(t: { claim: string; verdict: string }): string { return `${t.verdict}::${t.claim}`; }

/**
 * Merge an incoming signed bundle into the local lattice. Verifies the bundle's
 * signature + every per-truth signature OFFLINE; an unsigned/forged truth is DROPPED.
 * A truth that contradicts a local ACTIVE truth is SURFACED (the savant doesn't
 * silently pick a winner). Duplicates are skipped → idempotent + commutative. Never throws.
 */
export function mergeTruths(repoRoot: string, bundle: TruthBundle, opts: { issuedAt?: number } = {}): MergeResult {
  let bundleVerified = false;
  try { bundleVerified = bundle.receipt ? verifyReceipt(bundle.receipt).valid : false; } catch { bundleVerified = false; }

  const seen = loadSeen(repoRoot);
  let added = 0, duplicate = 0, rejectedUnsigned = 0;
  const conflicts: MergeResult["conflicts"] = [];
  const truths = Array.isArray(bundle?.truths) ? bundle.truths : [];

  for (const t of truths) {
    if (!t || typeof t.claim !== "string" || (t.verdict !== "TRUE" && t.verdict !== "FALSE")) continue;
    // (1) forgery defense — the per-truth signature must be valid AND the truth's
    //     claim/verdict must MATCH the signed payload. (Catches swapping the claim
    //     text while keeping a valid-but-unrelated signature.)
    let sigOk = false;
    try {
      if (t.receipt && verifyReceipt(t.receipt).valid) {
        const pl = (t.receipt.payload ?? {}) as { claim?: string; verdict?: string };
        sigOk = pl.claim === t.claim && pl.verdict === t.verdict;
      }
    } catch { sigOk = false; }
    if (!sigOk) { rejectedUnsigned++; continue; }
    const key = truthKey(t);
    if (seen.has(key)) { duplicate++; continue; }
    // (2) conflict — surfaced, never silently merged.
    const contra = detectContradictions(repoRoot, t.claim, t.verdict);
    if (contra.length > 0) { conflicts.push({ claim: t.claim, verdict: t.verdict, against: contra[0]!.existing }); seen.add(key); continue; }
    // (3) duplicate-by-content already in the local lattice?
    const already = readLattice(repoRoot).some((n) => n.status === "ACTIVE" && n.claim === t.claim && n.verdict === t.verdict);
    if (already) { duplicate++; seen.add(key); continue; }
    // (4) accept — record into the local lattice as a corroborated truth.
    recordAssertion(repoRoot, { claim: t.claim, verdict: t.verdict, pTrue: t.pTrue, lineageSummary: ["mesh"] }, { issuedAt: opts.issuedAt });
    added++; seen.add(key);
  }
  saveSeen(repoRoot, seen);

  const summary = `mesh merge from "${bundle?.agent ?? "?"}": +${added} added · ${duplicate} dup · ${rejectedUnsigned} forged-dropped · ${conflicts.length} conflict(s) surfaced · bundle ${bundleVerified ? "VERIFIED" : "UNVERIFIED"}`;
  return { added, duplicate, rejectedUnsigned, conflicts, bundleVerified, summary };
}

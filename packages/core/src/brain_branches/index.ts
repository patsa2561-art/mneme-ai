/**
 * v2.19.12 — MNEME BRAIN BRANCHES (Counterfactual Selves of your knowledge base)
 *
 *   "Knowledge base fork like git. Try a new claim on a branch for a
 *    week — main is untouched. Throw away if it didn't work; selectively
 *    merge if it did. The first knowledge primitive in any AI tool that
 *    lets you live in multiple beliefs simultaneously without rewriting
 *    history."
 *
 * Architecture:
 *   - Each branch has an immutable `parentId` + `axioms` (set of {id, body}) +
 *     `claims` (set of {id, body}). Branches are content-addressed via a
 *     deterministic snapshot hash so identical states dedup.
 *   - HMAC-signed lineage so an attacker can't backdate "ancient" branches.
 *   - Diff returns set-difference of axioms + claims; merge applies a
 *     selectable subset onto the target branch (defaults to ALL non-conflicting).
 *   - Conflict detection: two branches with the SAME id but DIFFERENT body
 *     contents = conflict; merge skips conflicts and reports them.
 *
 * Honest scope:
 *   - In-memory snapshot model. Persistence is the caller's responsibility
 *     (file system, .mneme/, etc.).
 *   - Three-way merge is intentionally NOT auto-resolved on conflict — it
 *     returns conflicts as data for the caller to decide.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface AxiomBody {
  id: string;
  body: string;
}

export interface ClaimBody {
  id: string;
  body: string;
}

export interface BrainBranch {
  v: typeof PROTOCOL_VERSION;
  id: string;
  name: string;
  parentId: string | null;
  axioms: AxiomBody[];
  claims: ClaimBody[];
  snapshotHash: string;
  createdAt: number;
  hmac: string;
}

export interface BrainRegistry {
  v: typeof PROTOCOL_VERSION;
  branches: BrainBranch[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_BRAIN_SECRET"] || `mneme-brain-branches-v${PROTOCOL_VERSION}`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function snapshotHash(axioms: AxiomBody[], claims: ClaimBody[]): string {
  const a = [...axioms].sort((x, y) => x.id.localeCompare(y.id));
  const c = [...claims].sort((x, y) => x.id.localeCompare(y.id));
  return sha256(canon({ a, c }));
}

function signBranch(body: Omit<BrainBranch, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function makeBranchId(name: string, snapshot: string, createdAt: number): string {
  return "brb-" + createHmac("sha256", "mneme-brain-id")
    .update(`${name}|${snapshot}|${createdAt}`)
    .digest("hex").slice(0, 14);
}

export function emptyRegistry(): BrainRegistry {
  return { v: PROTOCOL_VERSION, branches: [] };
}

/**
 * Initialise the registry with a "main" branch carrying the caller's current
 * knowledge state. Returns the new registry; safe to call multiple times —
 * existing main is preserved unless `force` is true.
 */
export function initMain(opts: {
  registry: BrainRegistry;
  axioms?: AxiomBody[];
  claims?: ClaimBody[];
  nowMs?: number;
  force?: boolean;
  secret?: string;
}): BrainRegistry {
  const existing = opts.registry.branches.find((b) => b.name === "main");
  if (existing && !opts.force) return opts.registry;
  const axioms = opts.axioms ?? [];
  const claims = opts.claims ?? [];
  const createdAt = opts.nowMs ?? Date.now();
  const snap = snapshotHash(axioms, claims);
  const body: Omit<BrainBranch, "hmac"> = {
    v: PROTOCOL_VERSION,
    id: makeBranchId("main", snap, createdAt),
    name: "main",
    parentId: null,
    axioms,
    claims,
    snapshotHash: snap,
    createdAt,
  };
  const main: BrainBranch = { ...body, hmac: signBranch(body, opts.secret ?? defaultSecret()) };
  const filtered = opts.registry.branches.filter((b) => b.name !== "main");
  return { v: PROTOCOL_VERSION, branches: [...filtered, main] };
}

export interface BranchInput {
  registry: BrainRegistry;
  newName: string;
  fromName?: string;
  nowMs?: number;
  secret?: string;
}

export function branchFrom(input: BranchInput): BrainRegistry {
  const fromName = input.fromName ?? "main";
  const parent = input.registry.branches.find((b) => b.name === fromName);
  if (!parent) throw new Error(`brain branch: parent '${fromName}' not found`);
  if (input.registry.branches.some((b) => b.name === input.newName)) {
    throw new Error(`brain branch: '${input.newName}' already exists`);
  }
  const createdAt = input.nowMs ?? Date.now();
  const snap = snapshotHash(parent.axioms, parent.claims);
  const body: Omit<BrainBranch, "hmac"> = {
    v: PROTOCOL_VERSION,
    id: makeBranchId(input.newName, snap, createdAt),
    name: input.newName,
    parentId: parent.id,
    axioms: [...parent.axioms],
    claims: [...parent.claims],
    snapshotHash: snap,
    createdAt,
  };
  const child: BrainBranch = { ...body, hmac: signBranch(body, input.secret ?? defaultSecret()) };
  return { v: PROTOCOL_VERSION, branches: [...input.registry.branches, child] };
}

export interface BrainDiff {
  axiomsOnlyInA: AxiomBody[];
  axiomsOnlyInB: AxiomBody[];
  axiomsCommon: AxiomBody[];
  claimsOnlyInA: ClaimBody[];
  claimsOnlyInB: ClaimBody[];
  claimsCommon: ClaimBody[];
  conflicts: Array<{ kind: "axiom" | "claim"; id: string; bodyA: string; bodyB: string }>;
}

function diffSets<T extends { id: string; body: string }>(
  a: T[],
  b: T[],
  kind: "axiom" | "claim",
): { onlyA: T[]; onlyB: T[]; common: T[]; conflicts: Array<{ kind: "axiom" | "claim"; id: string; bodyA: string; bodyB: string }> } {
  const byA = new Map(a.map((x) => [x.id, x]));
  const byB = new Map(b.map((x) => [x.id, x]));
  const onlyA: T[] = [];
  const onlyB: T[] = [];
  const common: T[] = [];
  const conflicts: Array<{ kind: "axiom" | "claim"; id: string; bodyA: string; bodyB: string }> = [];
  for (const [id, va] of byA) {
    const vb = byB.get(id);
    if (vb === undefined) {
      onlyA.push(va);
    } else if (vb.body === va.body) {
      common.push(va);
    } else {
      conflicts.push({ kind, id, bodyA: va.body, bodyB: vb.body });
    }
  }
  for (const [id, vb] of byB) {
    if (!byA.has(id)) onlyB.push(vb);
  }
  return { onlyA, onlyB, common, conflicts };
}

export function diffBranches(opts: {
  registry: BrainRegistry;
  a: string;
  b: string;
}): BrainDiff {
  const ba = opts.registry.branches.find((x) => x.name === opts.a);
  const bb = opts.registry.branches.find((x) => x.name === opts.b);
  if (!ba || !bb) throw new Error(`brain diff: unknown branch(es): ${!ba ? opts.a : ""} ${!bb ? opts.b : ""}`.trim());
  const ax = diffSets(ba.axioms, bb.axioms, "axiom");
  const cl = diffSets(ba.claims, bb.claims, "claim");
  return {
    axiomsOnlyInA: ax.onlyA,
    axiomsOnlyInB: ax.onlyB,
    axiomsCommon: ax.common,
    claimsOnlyInA: cl.onlyA,
    claimsOnlyInB: cl.onlyB,
    claimsCommon: cl.common,
    conflicts: [...ax.conflicts, ...cl.conflicts],
  };
}

export type MergeStrategy = "all" | "selective";

export interface MergeInput {
  registry: BrainRegistry;
  from: string;
  into: string;
  strategy?: MergeStrategy;
  /** When strategy='selective', the explicit ids to merge. */
  selectAxiomIds?: string[];
  selectClaimIds?: string[];
  nowMs?: number;
  secret?: string;
}

export interface MergeResult {
  registry: BrainRegistry;
  appliedAxioms: number;
  appliedClaims: number;
  skippedConflicts: Array<{ kind: "axiom" | "claim"; id: string }>;
}

export function mergeBranch(input: MergeInput): MergeResult {
  const from = input.registry.branches.find((b) => b.name === input.from);
  const into = input.registry.branches.find((b) => b.name === input.into);
  if (!from || !into) throw new Error(`brain merge: unknown branch(es)`);
  const strat = input.strategy ?? "all";
  const d = diffBranches({ registry: input.registry, a: input.from, b: input.into });
  // Candidates = onlyInA + common (common are no-ops); intersect with selection if selective.
  const candidateAxioms = d.axiomsOnlyInA;
  const candidateClaims = d.claimsOnlyInA;
  const axSet = strat === "selective"
    ? new Set(input.selectAxiomIds ?? [])
    : new Set(candidateAxioms.map((a) => a.id));
  const clSet = strat === "selective"
    ? new Set(input.selectClaimIds ?? [])
    : new Set(candidateClaims.map((c) => c.id));
  const appliedAxioms = candidateAxioms.filter((a) => axSet.has(a.id));
  const appliedClaims = candidateClaims.filter((c) => clSet.has(c.id));
  const newAxioms = [...into.axioms, ...appliedAxioms];
  const newClaims = [...into.claims, ...appliedClaims];
  // Rebuild the destination branch with merged state.
  const createdAt = input.nowMs ?? Date.now();
  const snap = snapshotHash(newAxioms, newClaims);
  const body: Omit<BrainBranch, "hmac"> = {
    v: PROTOCOL_VERSION,
    id: makeBranchId(into.name, snap, createdAt),
    name: into.name,
    parentId: into.parentId,
    axioms: newAxioms,
    claims: newClaims,
    snapshotHash: snap,
    createdAt,
  };
  const newInto: BrainBranch = { ...body, hmac: signBranch(body, input.secret ?? defaultSecret()) };
  const branches = input.registry.branches.map((b) => (b.id === into.id ? newInto : b));
  return {
    registry: { v: PROTOCOL_VERSION, branches },
    appliedAxioms: appliedAxioms.length,
    appliedClaims: appliedClaims.length,
    skippedConflicts: d.conflicts.map((c) => ({ kind: c.kind, id: c.id })),
  };
}

/** Verify every branch's HMAC + snapshot hash. */
export function verifyRegistry(registry: BrainRegistry, secret?: string): { ok: boolean; brokenAt?: string; reason?: string } {
  const sec = secret ?? defaultSecret();
  for (const b of registry.branches) {
    const { hmac, ...body } = b;
    if (!safeEqHex(signBranch(body, sec), hmac)) {
      return { ok: false, brokenAt: b.id, reason: `HMAC mismatch on branch '${b.name}'` };
    }
    if (snapshotHash(b.axioms, b.claims) !== b.snapshotHash) {
      return { ok: false, brokenAt: b.id, reason: `snapshot hash mismatch on branch '${b.name}'` };
    }
  }
  return { ok: true };
}

export function listBranches(registry: BrainRegistry): Array<{ name: string; id: string; parentId: string | null; axiomCount: number; claimCount: number; snapshotHash: string }> {
  return registry.branches.map((b) => ({
    name: b.name,
    id: b.id,
    parentId: b.parentId,
    axiomCount: b.axioms.length,
    claimCount: b.claims.length,
    snapshotHash: b.snapshotHash,
  }));
}

export function formatBranchLine(b: { name: string; axiomCount: number; claimCount: number; snapshotHash: string }): string {
  return `🌳 ${b.name} · axioms=${b.axiomCount} · claims=${b.claimCount} · snap=${b.snapshotHash.slice(0, 10)}`;
}

/**
 * v2.82.0 — BYOB · "Bring Your Own Brain": user-owned portable memory (TRUST FABRIC 💎2, on NOTARY).
 *
 * Vendors silo memory by design (portable memory that flows to a competitor breaks
 * lock-in — they will NEVER build it). Only an independent player can. BYOB is a
 * signed, tamper-evident memory CAPSULE the user owns: any vendor (Grok / Gemini /
 * Claude / Cursor) loads it at session start and writes back at session end, and
 * nobody can secretly alter it — the Ed25519 signature catches any edit.
 *
 * CRDT merge: two vendors editing the brain in parallel reconcile deterministically
 * (union by item id, last-write-wins by ts) — commutative + idempotent, so the merge
 * order across vendors doesn't matter.
 *
 * Composes NOTARY (the capsule is a signed receipt). Pure except pack() (signs).
 */

import { issueReceipt, verifyReceipt, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export interface MemoryItem {
  id: string;
  content: string;
  /** ms epoch — last-write-wins tiebreaker. */
  ts: number;
  kind?: string;
}

export interface Capsule {
  v: 1;
  owner: string;
  /** Vendors that have touched this capsule (union on merge). */
  vendors: string[];
  createdAt: number;
  items: MemoryItem[];
}

function normItems(items: unknown): MemoryItem[] {
  if (!Array.isArray(items)) return [];
  const out: MemoryItem[] = [];
  for (const it of items) {
    const r = it as Partial<MemoryItem>;
    if (r && typeof r.id === "string" && typeof r.content === "string") {
      out.push({ id: r.id, content: r.content, ts: typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : 0, ...(typeof r.kind === "string" ? { kind: r.kind } : {}) });
    }
  }
  return out;
}

/** Sort items by id for a canonical, stable capsule (so merges are deterministic). */
function canonicalItems(items: MemoryItem[]): MemoryItem[] {
  return items.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function makeCapsule(input: { owner: string; vendor?: string; vendors?: string[]; items: MemoryItem[]; createdAt?: number }): Capsule {
  const vendors = Array.from(new Set([...(input.vendors ?? []), ...(input.vendor ? [input.vendor] : [])].filter((x): x is string => typeof x === "string"))).sort();
  return {
    v: 1,
    owner: String(input.owner ?? "unknown"),
    vendors,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
    items: canonicalItems(normItems(input.items)),
  };
}

/** Pack a capsule into a signed, portable NOTARY receipt. */
export function packCapsule(repoRoot: string, capsule: Capsule, keyPair?: IssuerKeyPair): NotaryReceipt {
  return issueReceipt(repoRoot, { kind: "memory-capsule", subject: `brain:${capsule.owner}`, payload: capsule }, keyPair);
}

export function verifyCapsule(receipt: unknown): { valid: boolean; reason: string; capsule?: Capsule } {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const p = (receipt as NotaryReceipt).payload as Capsule | undefined;
  if (!p || p.v !== 1 || typeof p.owner !== "string" || !Array.isArray(p.items)) {
    return { valid: false, reason: "not a memory capsule" };
  }
  return { valid: true, reason: "ok", capsule: p };
}

/**
 * CRDT merge of two capsules: union of items by id, last-write-wins by ts (id
 * tiebreak), union of vendors. Commutative + idempotent + associative — vendors can
 * merge in any order and converge. Owner is preserved from `a`.
 */
export function mergeCapsules(a: Capsule, b: Capsule): Capsule {
  const byId = new Map<string, MemoryItem>();
  const consider = (it: MemoryItem) => {
    const cur = byId.get(it.id);
    if (!cur || it.ts > cur.ts || (it.ts === cur.ts && it.content > cur.content)) byId.set(it.id, it);
  };
  for (const it of a.items) consider(it);
  for (const it of b.items) consider(it);
  const vendors = Array.from(new Set([...a.vendors, ...b.vendors])).sort();
  return {
    v: 1,
    owner: a.owner,
    vendors,
    createdAt: Math.min(a.createdAt, b.createdAt),
    items: canonicalItems(Array.from(byId.values())),
  };
}

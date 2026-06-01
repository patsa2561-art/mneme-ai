/**
 * v2.137.0 — STELE (στήλη, "an inscribed public record").
 * =======================================================
 * Pillar 1 of the membrane vision: "an AI agent can't NOT know a capability
 * exists — and can PROVE it holds the latest, complete surface — at O(delta)
 * tokens, not O(900 tools)."
 *
 * The structural problem (not a persuasion problem): an agent that installed
 * Mneme doesn't reliably know what it can do. Today's answer — a giant manifest
 * stuffed into CLAUDE.md — goes STALE, costs O(all-tools) tokens every boot, and
 * carries no proof it's current or complete. An OpenAPI doc or an MCP tools/list
 * is the same: a dumb snapshot, no freshness/completeness proof, no incremental
 * sync.
 *
 * THE STELE fixes it the way git fixes large trees:
 *   - every capability is a content-addressed LEAF (sha256 of its identity),
 *   - all leaves roll up to a MERKLE ROOT (a 64-hex fingerprint of the WHOLE
 *     surface) — tamper-evident: change one capability ⇒ the root changes,
 *   - an agent holding root R asks for the DELTA vs current; roots match ⇒
 *     provably up-to-date (0 tokens); else it pulls ONLY added/changed/removed
 *     leaves (O(delta) tokens),
 *   - the root is NOTARY-signed at the CLI/MCP boundary, so "I hold the latest,
 *     complete surface" is a checkable claim, not a hope.
 *
 * DIAKRISIS — honest scope: the WIN is the delta-sync + the merkle freshness/
 * completeness proof (genuinely novel for an agent-capability manifest), NOT the
 * name. "An agent can't NOT know" holds only once the agent CALLS the stele on
 * boot — it composes with the activation membrane (pillar 3): the stele makes
 * knowing CHEAP + PROVABLE, activation makes it HAPPEN. Pure + deterministic +
 * total (the CLI/MCP add the signature).
 */

import { createHash } from "node:crypto";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }

/** A capability as the stele inscribes it — identity + content. */
export interface SteleEntry {
  name: string;
  /** version it was introduced (part of identity: a re-introduce changes the leaf). */
  version?: string;
  /** one-line summary (part of identity: an edit changes the leaf). */
  summary?: string;
}

export interface SteleLeaf { name: string; hash: string }
export interface Stele {
  root: string;
  count: number;
  leaves: SteleLeaf[];
}

/** The content-addressed leaf hash for a capability (its full identity). */
export function steleLeaf(e: SteleEntry): string {
  return sha256(`${String(e?.name ?? "")} ${String(e?.version ?? "")} ${String(e?.summary ?? "").slice(0, 400)}`);
}

/** Deterministic Merkle root over the (sorted) leaf hashes. "" if empty. Total. */
export function steleMerkleRoot(leafHashes: string[]): string {
  try {
    let level = [...(Array.isArray(leafHashes) ? leafHashes : [])].sort();
    if (level.length === 0) return "";
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const a = level[i]!;
        const b = i + 1 < level.length ? level[i + 1]! : a; // duplicate the last on odd count
        next.push(sha256(a + b));
      }
      level = next;
    }
    return level[0]!;
  } catch { return ""; }
}

/** Build the stele from a capability catalog. Order-independent + total. */
export function buildStele(entries: SteleEntry[]): Stele {
  try {
    const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.name === "string" && e.name);
    const byName = new Map<string, SteleEntry>();
    for (const e of list) byName.set(e.name, e); // dedupe by name, last wins
    const sorted = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const leaves: SteleLeaf[] = sorted.map((e) => ({ name: e.name, hash: steleLeaf(e) }));
    return { root: steleMerkleRoot(leaves.map((l) => l.hash)), count: leaves.length, leaves };
  } catch {
    return { root: "", count: 0, leaves: [] };
  }
}

export interface SteleDelta {
  currentRoot: string;
  upToDate: boolean;
  added: SteleEntry[];
  changed: SteleEntry[];
  removed: string[];
  deltaTokenEstimate: number;
  fullTokenEstimate: number;
  note: string;
}

const estTokens = (entries: SteleEntry[]): number =>
  Math.round((Array.isArray(entries) ? entries : []).reduce((n, e) => n + (String(e?.name ?? "").length + String(e?.summary ?? "").length), 0) / 4);

/**
 * The delta an agent needs given the (name→hash) map it currently holds. Returns
 * ONLY added/changed/removed — O(delta), not O(all). Held root == current root ⇒
 * provably up-to-date (no pull). Total + deterministic.
 */
export function steleDelta(entries: SteleEntry[], heldRoot: string, heldLeaves?: Record<string, string>): SteleDelta {
  try {
    const stele = buildStele(entries);
    const held = heldLeaves && typeof heldLeaves === "object" ? heldLeaves : {};
    if (typeof heldRoot === "string" && heldRoot.length > 0 && heldRoot === stele.root) {
      return { currentRoot: stele.root, upToDate: true, added: [], changed: [], removed: [], deltaTokenEstimate: 0, fullTokenEstimate: estTokens(entries), note: "agent holds the latest surface (merkle roots match) — 0 tokens to sync." };
    }
    const byName = new Map<string, SteleEntry>();
    for (const e of Array.isArray(entries) ? entries : []) if (e && e.name) byName.set(e.name, e);
    const added: SteleEntry[] = [];
    const changed: SteleEntry[] = [];
    for (const [name, e] of byName) {
      const h = steleLeaf(e);
      const heldHash = held[name];
      if (heldHash === undefined) added.push(e);
      else if (heldHash !== h) changed.push(e);
    }
    const removed = Object.keys(held).filter((n) => !byName.has(n));
    const deltaEntries = [...added, ...changed];
    return {
      currentRoot: stele.root,
      upToDate: false,
      added, changed, removed,
      deltaTokenEstimate: estTokens(deltaEntries),
      fullTokenEstimate: estTokens(entries),
      note: `${added.length} new + ${changed.length} changed + ${removed.length} removed — pull only these (O(delta)).`,
    };
  } catch {
    return { currentRoot: "", upToDate: false, added: [], changed: [], removed: [], deltaTokenEstimate: 0, fullTokenEstimate: 0, note: "stele delta error — abstaining." };
  }
}

/** Verify a held root against the live catalog (staleness-/tamper-evident). Total. */
export function verifyStele(entries: SteleEntry[], claimedRoot: string): { ok: boolean; currentRoot: string; reason: string } {
  try {
    const s = buildStele(entries);
    const ok = typeof claimedRoot === "string" && claimedRoot === s.root;
    return { ok, currentRoot: s.root, reason: ok ? "root matches the live catalog (surface is complete + current)" : "root mismatch — held surface is stale or tampered; sync the delta" };
  } catch { return { ok: false, currentRoot: "", reason: "verify error" }; }
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface SteleGauntlet {
  rootDeterministic: boolean;
  rootChangesOnEdit: boolean;
  rootChangesOnAdd: boolean;
  upToDateWhenRootsMatch: boolean;
  deltaReturnsOnlyChanged: boolean;
  detectsRemoved: boolean;
  detectsTamperedLeaf: boolean;
  deltaCheaperThanFull: boolean;
  verifyCatchesStale: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function steleGauntlet(): SteleGauntlet {
  const base: SteleEntry[] = [
    { name: "mneme.a", version: "1.0.0", summary: "alpha" },
    { name: "mneme.b", version: "1.0.0", summary: "beta" },
    { name: "mneme.c", version: "1.0.0", summary: "gamma" },
  ];
  const s0 = buildStele(base);

  const rootDeterministic = buildStele(base).root === s0.root && s0.root.length === 64 && buildStele([...base].reverse()).root === s0.root;

  const edited = base.map((e) => e.name === "mneme.b" ? { ...e, summary: "beta v2" } : e);
  const rootChangesOnEdit = buildStele(edited).root !== s0.root;
  const rootChangesOnAdd = buildStele([...base, { name: "mneme.d", version: "2.0.0", summary: "delta" }]).root !== s0.root;

  const heldNow: Record<string, string> = Object.fromEntries(s0.leaves.map((l) => [l.name, l.hash]));
  const d0 = steleDelta(base, s0.root, heldNow);
  const upToDateWhenRootsMatch = d0.upToDate && d0.deltaTokenEstimate === 0;

  // agent holds the OLD surface; current = b-edited + d-added, a-removed.
  const current = [...edited.filter((e) => e.name !== "mneme.a"), { name: "mneme.d", version: "2.0.0", summary: "delta" }];
  const dDelta = steleDelta(current, s0.root, heldNow);
  const deltaReturnsOnlyChanged = dDelta.added.some((e) => e.name === "mneme.d")
    && dDelta.changed.some((e) => e.name === "mneme.b")
    && !dDelta.added.some((e) => e.name === "mneme.c")
    && !dDelta.changed.some((e) => e.name === "mneme.c");
  const detectsRemoved = dDelta.removed.includes("mneme.a");

  const tampered = { ...heldNow, "mneme.c": "deadbeef" };
  const detectsTamperedLeaf = steleDelta(base, "stale-root", tampered).changed.some((e) => e.name === "mneme.c");

  const deltaCheaperThanFull = dDelta.deltaTokenEstimate < dDelta.fullTokenEstimate;
  const verifyCatchesStale = verifyStele(current, s0.root).ok === false && verifyStele(base, s0.root).ok === true;
  const deterministic = JSON.stringify(steleDelta(current, s0.root, heldNow)) === JSON.stringify(steleDelta(current, s0.root, heldNow));

  let total = true;
  try {
    buildStele(null as unknown as SteleEntry[]);
    steleDelta(undefined as unknown as SteleEntry[], null as unknown as string, null as unknown as Record<string, string>);
    verifyStele([], null as unknown as string);
    steleMerkleRoot([]); steleLeaf(null as unknown as SteleEntry);
  } catch { total = false; }

  const all = rootDeterministic && rootChangesOnEdit && rootChangesOnAdd && upToDateWhenRootsMatch && deltaReturnsOnlyChanged
    && detectsRemoved && detectsTamperedLeaf && deltaCheaperThanFull && verifyCatchesStale && deterministic && total;
  return {
    rootDeterministic, rootChangesOnEdit, rootChangesOnAdd, upToDateWhenRootsMatch, deltaReturnsOnlyChanged,
    detectsRemoved, detectsTamperedLeaf, deltaCheaperThanFull, verifyCatchesStale, deterministic, total,
    score: all ? 100 : 0,
  };
}

/**
 * v1.79.0 -- NEURON: auto-derive intent atoms from ANY tool catalog.
 *
 * The LATTICE catalog ships 8 hand-crafted atoms. But Mneme has 100+
 * MCP tools, each with `triggers[]` already. Instead of hand-writing
 * an atom for every tool, NEURON reads the catalog and turns every
 * trigger phrase into a routable atom.
 *
 * Net effect: every Mneme tool becomes auto-discoverable by phrase --
 * the AI agent can route correctly without us hand-curating each one.
 */

import type { IntentAtom } from "../lattice/intent_atoms.js";

export interface ToolLike {
  /** Tool name, e.g. "mneme.apoptosis.detect". */
  name: string;
  /** Optional plain-English summary. */
  description?: string;
  /** Phrases that should route to this tool. */
  triggers?: readonly string[];
  /** When the AI should call this tool. */
  whenToUse?: string;
}

/** Convert a tool catalog into intent atoms. */
export function deriveAtomsFromCatalog(tools: readonly ToolLike[]): IntentAtom[] {
  const out: IntentAtom[] = [];
  for (const t of tools) {
    if (!t.triggers || t.triggers.length === 0) continue;
    const intent = t.whenToUse ?? t.description ?? `call ${t.name}`;
    out.push({
      triggers: [...t.triggers],
      tool: t.name,
      priority: "strong",
      intent: intent.length > 140 ? intent.slice(0, 137) + "..." : intent,
    });
  }
  return out;
}

/** Merge auto-derived atoms with the hand-crafted lattice catalog. The
 *  hand-crafted ones win on conflict (priority=absolute beats strong). */
export function mergeAtoms(
  handCrafted: readonly IntentAtom[],
  autoDerived: readonly IntentAtom[],
): IntentAtom[] {
  const out = [...handCrafted];
  const handTools = new Set(handCrafted.map((a) => a.tool));
  for (const a of autoDerived) {
    if (!handTools.has(a.tool)) out.push(a);
  }
  return out;
}

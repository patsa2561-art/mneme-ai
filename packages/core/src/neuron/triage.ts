/**
 * v1.79.0 -- NEURON: TELEPATHIC TRIAGE.
 *
 * The molecule of intelligence. Receives a user prompt + a tool
 * catalog, and routes it via 4 stacked strategies (each independent):
 *
 *   1. EXACT LATTICE -- hand-crafted intent atoms, priority=absolute
 *   2. AUTO-DERIVED  -- every tool's triggers[] becomes a fallback atom
 *   3. FUZZY TRIGRAM -- Jaccard similarity for near-matches
 *   4. KEYWORD BIAS  -- prompt mentions "mneme" / "soul" / "version" etc.
 *
 * Returns a ranked list of {tool, confidence, strategy, reason}.
 * If the top result is `absolute` (strategy = exact lattice), AI must
 * obey. Otherwise it can pick the top candidate or surface 2-3 for
 * the user.
 *
 * NEW WILDEST FUNCTION (nobody dares to ship this): even when no
 * direct match, NEURON returns a confidence-weighted "best guess"
 * with a `confusion: true` flag so the AI knows to ask the user.
 */

import { routeIntent, INTENT_ATOMS, type IntentAtom } from "../lattice/intent_atoms.js";
import { rankByFuzzy } from "./fuzzy.js";
import { deriveAtomsFromCatalog, mergeAtoms, type ToolLike } from "./auto_atoms.js";

export type TriageStrategy = "exact-lattice" | "auto-derived" | "fuzzy-trigram" | "keyword-bias";

export interface TriageCandidate {
  tool: string;
  confidence: number;
  strategy: TriageStrategy;
  reason: string;
  matchedTrigger?: string;
  intent: string;
}

export interface TriageReport {
  /** Top recommendation. */
  recommended: TriageCandidate | null;
  /** All candidates above threshold, sorted by confidence desc. */
  candidates: TriageCandidate[];
  /** True when top candidate is < 0.7 OR there are 2+ candidates
   *  within 0.1 confidence -- AI should ask the user to clarify. */
  confusion: boolean;
  summary: string;
}

const MNEME_KEYWORD_RE = /\b(mneme|soul prompt|ส่งสมอง)\b/i;
const FUZZY_THRESHOLD = 0.20;

/** Run the full 4-strategy triage. */
export function telepathicTriage(
  userPrompt: string,
  toolCatalog: readonly ToolLike[] = [],
): TriageReport {
  if (!userPrompt || !userPrompt.trim()) {
    return {
      recommended: null,
      candidates: [],
      confusion: false,
      summary: "empty prompt -- nothing to route",
    };
  }
  const candidates: TriageCandidate[] = [];

  // Strategy 1: exact lattice (hand-crafted, absolute priority wins).
  const latticeMatch = routeIntent(userPrompt);
  if (latticeMatch) {
    candidates.push({
      tool: latticeMatch.atom.tool,
      confidence: latticeMatch.absolute ? 1.0 : 0.85,
      strategy: "exact-lattice",
      reason: `hand-crafted intent atom matched "${latticeMatch.matchedTrigger}"`,
      matchedTrigger: latticeMatch.matchedTrigger,
      intent: latticeMatch.atom.intent,
    });
  }

  // Strategy 2 + 3: auto-derived atoms from tool catalog (fuzzy ranked).
  const autoAtoms = deriveAtomsFromCatalog(toolCatalog);
  const allAtoms = mergeAtoms(INTENT_ATOMS, autoAtoms);
  const fuzzyRanked = rankByFuzzy(
    userPrompt,
    allAtoms.map((a) => ({ item: a, triggers: a.triggers })),
    FUZZY_THRESHOLD,
  );
  const seenTools = new Set(candidates.map((c) => c.tool));
  for (const r of fuzzyRanked.slice(0, 5)) {
    if (seenTools.has(r.item.tool)) continue;
    const isAutoDerived = autoAtoms.some((a) => a.tool === r.item.tool);
    candidates.push({
      tool: r.item.tool,
      confidence: Math.min(0.85, r.similarity + 0.1),
      strategy: isAutoDerived ? "auto-derived" : "fuzzy-trigram",
      reason: `trigram similarity ${(r.similarity * 100).toFixed(0)}% to "${r.matched}"`,
      matchedTrigger: r.matched,
      intent: (r.item as IntentAtom).intent,
    });
    seenTools.add(r.item.tool);
  }

  // Strategy 4: keyword bias -- prompt mentions Mneme generally,
  // suggest the most likely tool (system.upgrade if "update", etc.)
  if (candidates.length === 0 && MNEME_KEYWORD_RE.test(userPrompt)) {
    candidates.push({
      tool: "mneme.lattice.route",
      confidence: 0.3,
      strategy: "keyword-bias",
      reason: "prompt mentions Mneme but no atom matched -- route via lattice for disambiguation",
      intent: "ask the user what they want",
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const recommended = candidates[0] ?? null;
  const confusion =
    !recommended ||
    recommended.confidence < 0.7 ||
    (candidates.length >= 2 && candidates[0]!.confidence - candidates[1]!.confidence < 0.1);

  const summary = recommended
    ? confusion
      ? `${candidates.length} candidates -- top: ${recommended.tool} @ ${(recommended.confidence * 100).toFixed(0)}% (ASK USER, low confidence or tied)`
      : `route to ${recommended.tool} @ ${(recommended.confidence * 100).toFixed(0)}% via ${recommended.strategy}`
    : "no route found";

  return { recommended, candidates, confusion, summary };
}

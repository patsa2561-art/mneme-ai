/**
 * Molecule compiler — turn natural-language intent into a concrete
 * pipeline of registered atoms / molecules.
 *
 * Pipeline:
 *   1. Tokenise the intent + extract signals (verbs, domains, time
 *      windows, author hints, file paths).
 *   2. Score every catalog manifest against the signals via a cheap
 *      keyword + tag overlap. Top-N candidates form the seed set.
 *   3. For an LLM-available environment, ask the LLM to assemble a
 *      MoleculePlan from the seed set. For an offline / no-LLM
 *      environment, fall back to a rule-based assembler (still produces
 *      a useful plan; just less creative composition).
 *   4. Cost-rank candidate plans by sum(ms_p50). Return the cheapest.
 *
 * The output is a MoleculePlan — a JSON-shape that downstream
 * `executePlan()` can run, and that the user can audit before running
 * (--dry-run prints the plan).
 */

import { registry } from "./registry.js";
import type { AnyManifest } from "./manifest.js";

export interface MoleculeStep {
  /** Manifest id this step references. */
  id: string;
  /** Bound parameters for this step. */
  args: Record<string, unknown>;
  /** Optional human-readable rationale (LLM emits this). */
  why?: string;
}

export interface MoleculePlan {
  /** Original user intent. */
  intent: string;
  /** Steps in execution order. */
  steps: MoleculeStep[];
  /** Sum of ms_p50 across steps — the planning cost estimate. */
  estimatedMsP50: number;
  /** Whether the plan was assembled by LLM or by the rule-based fallback. */
  source: "llm" | "rule-based";
  /** Reasoning trace for audit. */
  trace: string[];
}

export interface CompileOptions {
  intent: string;
  /** Optional pre-fetched seed set. When omitted we compute it. */
  seedIds?: string[];
  /** Cap on candidate seeds. Default 12. */
  maxSeeds?: number;
  /** Cap on plan length. Default 6 steps. */
  maxSteps?: number;
}

/* ─────────────────  Signal extraction  ─────────────────────────────── */

const VERB_HINTS: Record<string, string[]> = {
  scan:        ["security", "git", "scan"],
  find:        ["search", "scan"],
  search:      ["search", "vector"],
  show:        ["render"],
  audit:       ["security", "audit"],
  blame:       ["git", "history"],
  diff:        ["git", "scan"],
  embed:       ["embed", "vector", "ml"],
  cluster:     ["cluster", "ml"],
  count:       ["math"],
  measure:     ["bench", "math"],
  compare:     ["math", "vector"],
};

const DOMAIN_HINTS: Record<string, string[]> = {
  vulnerab:    ["security", "scan"],
  security:    ["security"],
  todo:        ["karma"],
  fixme:       ["karma"],
  authors:     ["people", "history"],
  contributor: ["people"],
  performance: ["bench", "hpc"],
  similar:     ["vector"],
  embedding:   ["vector", "embed"],
  health:      ["repo-mri", "originals"],
  voice:       ["twin", "stylometry"],
  style:       ["twin", "stylometry"],
};

interface IntentSignals {
  /** Tags to bias the seed scorer. */
  tags: string[];
  /** Free tokens (lowercased words ≥ 3 chars). */
  tokens: string[];
}

export function extractSignals(intent: string): IntentSignals {
  const lower = intent.toLowerCase();
  const tokens = Array.from(new Set(
    lower
      .split(/[^a-z0-9.@-]+/)
      .filter((t) => t.length >= 3),
  ));
  const tags = new Set<string>();
  for (const t of tokens) {
    const verb = VERB_HINTS[t];
    if (verb) for (const v of verb) tags.add(v);
    for (const [needle, addTags] of Object.entries(DOMAIN_HINTS)) {
      if (t.includes(needle)) for (const tag of addTags) tags.add(tag);
    }
  }
  return { tags: Array.from(tags), tokens };
}

/* ─────────────────  Seed scoring  ──────────────────────────────────── */

interface ScoredManifest {
  manifest: AnyManifest;
  score: number;
}

export function scoreSeeds(signals: IntentSignals): ScoredManifest[] {
  const scored: ScoredManifest[] = [];
  for (const m of registry.all()) {
    let score = 0;
    // Tag overlap is the strongest signal
    for (const t of signals.tags) {
      if (m.tags.includes(t)) score += 5;
    }
    // Token in id / summary (case-insensitive)
    const blob = (m.id + " " + m.summary + " " + m.description).toLowerCase();
    for (const tok of signals.tokens) {
      if (blob.includes(tok)) score += 1;
    }
    // Slight kind bias — atoms + molecules are usually more useful starting
    // points than raw elements (planning sugar).
    if (m.kind === "atom") score += 0.5;
    if (m.kind === "molecule") score += 1.5;
    if (m.kind === "compound") score += 2;
    if (score > 0) scored.push({ manifest: m, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/* ─────────────────  Rule-based plan assembler  ─────────────────────── */

/**
 * Offline fallback assembler. Picks the highest-scoring molecule (or
 * compound) as the trunk. If no molecule scores > 0, falls back to the
 * highest-scoring atom. If no atom either, picks the top-scoring
 * element. This always produces a runnable plan (even if "search for
 * banana" defaults to embed.text + vector.search).
 */
export function assemblePlanRuleBased(
  intent: string,
  scored: ScoredManifest[],
  maxSteps: number,
): MoleculePlan {
  const trace: string[] = [];
  const steps: MoleculeStep[] = [];
  let estimatedMsP50 = 0;

  // Prefer molecules first
  const trunk =
    scored.find((s) => s.manifest.kind === "molecule" || s.manifest.kind === "compound") ??
    scored.find((s) => s.manifest.kind === "atom") ??
    scored.find((s) => s.manifest.kind === "element");

  if (!trunk) {
    return {
      intent,
      steps: [],
      estimatedMsP50: 0,
      source: "rule-based",
      trace: ["No matching primitive — try a more specific intent."],
    };
  }

  trace.push(`trunk: ${trunk.manifest.id} (score ${trunk.score.toFixed(1)})`);
  steps.push({ id: trunk.manifest.id, args: {}, why: trunk.manifest.summary });
  estimatedMsP50 += trunk.manifest.cost.msP50;

  // Pull in 1-2 supporting elements/atoms that share tags but aren't the trunk
  const trunkTags = new Set(trunk.manifest.tags);
  const supporting = scored
    .filter((s) => s.manifest.id !== trunk.manifest.id)
    .filter((s) => s.manifest.tags.some((t) => trunkTags.has(t)))
    .slice(0, Math.max(0, maxSteps - 1));
  for (const s of supporting) {
    if (steps.length >= maxSteps) break;
    trace.push(`support: ${s.manifest.id} (score ${s.score.toFixed(1)})`);
    steps.push({ id: s.manifest.id, args: {}, why: s.manifest.summary });
    estimatedMsP50 += s.manifest.cost.msP50;
  }

  return {
    intent,
    steps,
    estimatedMsP50,
    source: "rule-based",
    trace,
  };
}

/**
 * Compile an intent into a plan. Pure (no I/O, no LLM) — the rule-based
 * path. The LLM-augmented path is exposed by the CLI command (which has
 * access to the enricher).
 */
export function compilePlan(opts: CompileOptions): MoleculePlan {
  const signals = extractSignals(opts.intent);
  const scored = scoreSeeds(signals);
  const seeds = opts.seedIds
    ? scored.filter((s) => opts.seedIds!.includes(s.manifest.id))
    : scored.slice(0, opts.maxSeeds ?? 12);
  return assemblePlanRuleBased(opts.intent, seeds, opts.maxSteps ?? 6);
}

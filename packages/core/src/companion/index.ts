/**
 * v2.22.0 — COMPANION.
 *
 * Five composed primitives that turn every Mneme verb into an AI-
 * agent-friendly surface:
 *
 *   1. CONTRACT    — pre/post-conditions, side-effects, DEFCON tier
 *   2. AUTOSPEC    — JSON Schema for args + validate() helper
 *   3. DOPPELGANGER — copy-on-write dry-run + diff
 *   4. STORYLINE   — Markov chain over pheromone log
 *   5. LEARN LOOP  — failure patterns + outcome stats
 *
 * Auto-registration: any new verb that appears in
 * `MNEME_COMMAND_CATALOG` automatically gets contract + autospec.
 * Doppelganger + storyline + learn-loop activate once the verb has
 * been invoked at least once (pheromone seed).
 *
 * Public API:
 *   companionFor(verb)       — composed Companion for a single verb
 *   formatCompanion(c)       — human-readable rendering
 *   listCompanionable()      — verbs that have full data
 *   companionableCoverage()  — % of catalog with at least contract+autospec
 */

export { contractFor, allContracts, findContract, formatContract, type VerbContract, type DefconLevel, type IdempotencyLevel } from "./contract.js";
export { parseArgSchema, schemaFor, validateArgs, formatSchema, allSchemas, type ArgSchema, type ValidateResult, type ProvidedArgs } from "./autospec.js";
export { dryRun, stageCommit, applyCommit, formatDoppelganger, type DoppelgangerResult, type FileEffect, type DoppelgangerOptions, type CommitOptions } from "./doppelganger.js";
export { predictNext, predictPrior, formatStoryline, type TransitionStats, type StorylineQuery } from "./storyline.js";
export { computeOutcomeStats, commonMistakes, redactInvocation, formatOutcomeStats, formatMistakes, type VerbOutcomeStats, type CommonMistake, type RedactedInvocation } from "./learn_loop.js";

import { contractFor, findContract, formatContract, type VerbContract } from "./contract.js";
import { schemaFor, formatSchema, type ArgSchema } from "./autospec.js";
import { predictNext, predictPrior, formatStoryline, type TransitionStats } from "./storyline.js";
import { computeOutcomeStats, commonMistakes, formatOutcomeStats, formatMistakes, type VerbOutcomeStats, type CommonMistake } from "./learn_loop.js";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

export interface Companion {
  v: 1;
  verb: string;
  contract: VerbContract;
  argSchema: ArgSchema;
  storyline: { next: TransitionStats[]; prior: TransitionStats[] };
  outcomeStats: VerbOutcomeStats;
  commonMistakes: CommonMistake[];
  /** Coverage flag — `false` means catalog metadata only, no live data yet. */
  hasLiveData: boolean;
  generatedAt: string;
}

export interface BuildCompanionOptions {
  repoRoot?: string;
  topK?: number;
}

export function companionFor(verb: string, opts: BuildCompanionOptions = {}): Companion | null {
  const contract = findContract(verb);
  if (!contract) return null;
  const argSchema = schemaFor({ command: contract.verb, since: contract.since, what: contract.summary, when: contract.invokeWhen, group: contract.group } as ManifestCommand);
  const repoRoot = opts.repoRoot;
  const next = repoRoot ? predictNext(repoRoot, contract.verb, { topK: opts.topK ?? 5 }) : [];
  const prior = repoRoot ? predictPrior(repoRoot, contract.verb, { topK: opts.topK ?? 5 }) : [];
  const outcomeStats = repoRoot
    ? computeOutcomeStats(repoRoot, contract.verb)
    : { verb: contract.verb, invocations: 0, successes: 0, failures: 0, successRate: 0, recentInvocations: 0, recentSuccessRate: 0 };
  const mistakes = repoRoot ? commonMistakes(repoRoot, contract.verb) : [];
  return {
    v: 1,
    verb: contract.verb,
    contract,
    argSchema,
    storyline: { next, prior },
    outcomeStats,
    commonMistakes: mistakes,
    hasLiveData: outcomeStats.invocations > 0,
    generatedAt: new Date().toISOString(),
  };
}

export function formatCompanion(c: Companion): string {
  return [
    formatContract(c.contract),
    "",
    formatSchema(c.argSchema),
    "",
    formatStoryline(c.verb, c.storyline.next, c.storyline.prior),
    "",
    formatOutcomeStats(c.outcomeStats),
    "",
    formatMistakes(c.commonMistakes),
    "",
    `  // companion data live: ${c.hasLiveData ? "yes" : "no — invoke the verb at least once to seed"}`,
  ].join("\n");
}

/** Catalog-wide coverage report. Useful for CI + dashboards. */
export interface CoverageReport {
  total: number;
  withContract: number;
  withAutospec: number;
  withLiveData: number;
  coverageContract: number;
  coverageAutospec: number;
  coverageLiveData: number;
}

export function companionableCoverage(repoRoot: string, catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): CoverageReport {
  let withContract = 0, withAutospec = 0, withLiveData = 0;
  for (const entry of catalog) {
    const c = contractFor(entry);
    if (c) withContract++;
    const s = schemaFor(entry);
    if (s) withAutospec++;
    const stats = computeOutcomeStats(repoRoot, entry.command);
    if (stats.invocations > 0) withLiveData++;
  }
  const total = catalog.length;
  return {
    total,
    withContract,
    withAutospec,
    withLiveData,
    coverageContract: total === 0 ? 0 : withContract / total,
    coverageAutospec: total === 0 ? 0 : withAutospec / total,
    coverageLiveData: total === 0 ? 0 : withLiveData / total,
  };
}

export function listCompanionable(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): string[] {
  return catalog.map((e) => e.command).sort();
}

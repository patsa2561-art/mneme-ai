/**
 * v2.22.0 — COMPANION · CONTRACT.
 *
 * Each verb in the catalog gets a derived contract: preconditions,
 * postconditions, side-effects, idempotency level, DEFCON impact.
 * The contract is auto-derived from the manifest entry first, then
 * optionally overridden by a hand-authored file at
 * `packages/core/src/companion/overrides/<verb-slug>.json`.
 *
 * Why this lives apart from `agent_manifest.ts`:
 *   - manifest is the single-line "what + when" surface AI agents
 *     read by default;
 *   - contract is the deep structured form AI agents read BEFORE
 *     invoking a verb the first time. They serve different audiences.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

export type DefconLevel = 1 | 2 | 3 | 4 | 5;
// 5 = read-only      (atlas, hot, tags, route)
// 4 = mutates local  (probe, grant, verdict)
// 3 = mutates shared (federation push, gist transmit)
// 2 = destructive    (revoke, uninstall, fire)
// 1 = irreversible   (mortuary fire, system upgrade, archeology cull)

export type IdempotencyLevel = "read-only" | "idempotent" | "additive" | "destructive";

export interface VerbContract {
  v: 1;
  verb: string;
  since: string;
  group: string;
  /** Plain-English summary (= manifest `what`). */
  summary: string;
  /** When to invoke (= manifest `when`). */
  invokeWhen: string;
  /** Preconditions that MUST hold or invocation should be refused. */
  preconditions: string[];
  /** Outcome guarantees. */
  postconditions: string[];
  /** Files/state Mneme writes when this verb succeeds. */
  sideEffects: string[];
  /** Repeatable without harm? */
  idempotency: IdempotencyLevel;
  /** Impact tier — drives doppelganger requirement. */
  defcon: DefconLevel;
  /** Whether the verb is read-only (no fs/network mutation). */
  readOnly: boolean;
  /** Whether the verb consults an external network endpoint. */
  reachesNetwork: boolean;
  /** Cross-verb storyline hints — common predecessors / successors. */
  comesAfter: string[];
  comesBefore: string[];
  /** Where the contract came from. */
  source: "auto" | "override" | "hybrid";
}

// ─── HEURISTIC AUTO-DERIVATION ────────────────────────────────────────

// Hints are matched as whole words in the description and as substrings
// inside the command verb. Terms here MUST be unambiguous — e.g. "abort"
// + "rollback" appear in many neutral descriptions ("exit on ABORT
// band", "rollback safety"), so we drop them from destructive list.
const READ_HINTS = ["list", "show", "print", "verify", "audit", "diagnose", "probe", "scan", "report", "status", "view", "stats", "leaderboard", "atlas", "tags", "hot", "bloom", "route", "rights", "doctor"];
const DESTRUCTIVE_HINTS = ["delete", "remove", "uninstall", "purge", "wipe", "nuke", "destroy", "revoke"];
const IRREVERSIBLE_HINTS = ["uninstall", "publish to npm", "deploy", "fire", "cull"];
const NETWORK_HINTS = ["push", "fetch", "sync", "transmit", "broadcast", "federation"];

/** Match a hint as a whole word in the command-verb portion (heavier
 *  weight) or in the description (lighter weight). Avoids false
 *  positives like "ABORT" inside a trust-band enum string. */
function hintHits(entry: ManifestCommand, hints: string[]): boolean {
  // Command-name is the strongest signal — match anywhere in the verb token.
  const cmd = entry.command.toLowerCase();
  for (const h of hints) if (cmd.includes(h)) return true;
  // Description: word-boundary only, to skip enum-value spelunking.
  const desc = entry.what.toLowerCase();
  for (const h of hints) {
    const re = new RegExp(`\\b${h.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`);
    if (re.test(desc)) return true;
  }
  return false;
}

function detectReadOnly(entry: ManifestCommand): boolean {
  const isRead = hintHits(entry, READ_HINTS);
  const isDestructive = hintHits(entry, DESTRUCTIVE_HINTS);
  return isRead && !isDestructive;
}

function detectNetwork(entry: ManifestCommand): boolean {
  const haystack = `${entry.command} ${entry.what}`.toLowerCase();
  // some verbs say "no network" explicitly — respect that
  if (/(no network|offline|pure local|no\s+llm)/.test(haystack)) return false;
  return hintHits(entry, NETWORK_HINTS);
}

function detectDefcon(entry: ManifestCommand): DefconLevel {
  if (hintHits(entry, IRREVERSIBLE_HINTS)) return 1;
  if (hintHits(entry, DESTRUCTIVE_HINTS)) return 2;
  if (detectNetwork(entry)) return 3;
  if (detectReadOnly(entry)) return 5;
  return 4; // local-mutating default
}

function detectIdempotency(entry: ManifestCommand): IdempotencyLevel {
  if (detectReadOnly(entry)) return "read-only";
  const haystack = `${entry.command} ${entry.what}`.toLowerCase();
  if (DESTRUCTIVE_HINTS.some((h) => haystack.includes(h))) return "destructive";
  if (/(append|record|log|drop\s+pheromone|capture|inscribe)/.test(haystack)) return "additive";
  return "idempotent";
}

function detectSideEffects(entry: ManifestCommand): string[] {
  const out: string[] = [];
  const m = entry.what.match(/`(\.mneme\/[^`]+|node_modules\/[^`]+|\$HOME[^`]+|~\/\.mneme[^`]+)`/g);
  if (m) for (const path of m) out.push(`writes ${path.replace(/`/g, "")}`);
  if (detectNetwork(entry)) out.push("reaches an external network endpoint");
  if (out.length === 0 && !detectReadOnly(entry)) out.push("mutates local state (unspecified — improve the manifest entry)");
  return out;
}

function detectPreconditions(entry: ManifestCommand): string[] {
  const out: string[] = [];
  // very simple rule-based — works for the obvious cases
  const w = entry.what.toLowerCase();
  if (/baseline|probes/.test(w)) out.push("≥5 probes recorded for the target vendor");
  if (/key|hmac|sig/.test(w)) out.push("install HMAC key exists at .mneme/<feature>/*.key");
  if (/inbox|pulse|daemon/.test(w)) out.push("Mneme daemon is reachable OR the verb falls back to disk read");
  if (out.length === 0) out.push("none beyond installed Mneme + readable repo root");
  return out;
}

function detectPostconditions(entry: ManifestCommand): string[] {
  if (detectReadOnly(entry)) return ["returns stdout payload; no state change"];
  return ["records a side-effect listed above OR returns a non-zero exit code"];
}

// ─── OVERRIDE LOADING ────────────────────────────────────────────────

function overrideDir(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "overrides");
  } catch {
    return ""; // no overrides reachable
  }
}

function slugify(command: string): string {
  return command.replace(/^mneme\s+/, "").replace(/[\s<>\[\]|'"]+/g, "_").toLowerCase();
}

function loadOverride(verb: string): Partial<VerbContract> | null {
  const dir = overrideDir();
  if (!dir) return null;
  const p = join(dir, `${slugify(verb)}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────

/** Derive (and override if a file exists) the contract for a single
 *  catalog entry. Pure function — no disk writes. */
export function contractFor(entry: ManifestCommand): VerbContract {
  const auto: VerbContract = {
    v: 1,
    verb: entry.command,
    since: entry.since,
    group: entry.group,
    summary: entry.what,
    invokeWhen: entry.when,
    preconditions: detectPreconditions(entry),
    postconditions: detectPostconditions(entry),
    sideEffects: detectSideEffects(entry),
    idempotency: detectIdempotency(entry),
    defcon: detectDefcon(entry),
    readOnly: detectReadOnly(entry),
    reachesNetwork: detectNetwork(entry),
    comesAfter: [],
    comesBefore: [],
    source: "auto",
  };
  const override = loadOverride(entry.command);
  if (!override) return auto;
  return { ...auto, ...override, source: "hybrid" };
}

/** Return contracts for every catalog verb. Used by the conductor's
 *  planner + as the canonical companion seed. */
export function allContracts(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): VerbContract[] {
  return catalog.map(contractFor);
}

export function findContract(verb: string, catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): VerbContract | null {
  const stems = [verb, "mneme " + verb, verb.replace(/^mneme\s+/, "")];
  for (const entry of catalog) {
    if (stems.includes(entry.command)) return contractFor(entry);
    // prefix match — `mneme earthquake` matches `mneme earthquake drift`
    if (entry.command.startsWith(verb) || entry.command.startsWith(stems[1]!)) return contractFor(entry);
  }
  return null;
}

export function formatContract(c: VerbContract): string {
  const lines: string[] = [];
  const defconBadge = c.defcon === 5 ? "🟢 5 read-only"
                    : c.defcon === 4 ? "🟡 4 mutates local state"
                    : c.defcon === 3 ? "🟠 3 reaches network"
                    : c.defcon === 2 ? "🔴 2 destructive (recoverable)"
                                     : "💀 1 irreversible";
  lines.push(`📜 CONTRACT — ${c.verb}`);
  lines.push("");
  lines.push(`  Since:           ${c.since}  ·  group: ${c.group}  ·  source: ${c.source}`);
  lines.push(`  DEFCON:          ${defconBadge}`);
  lines.push(`  Idempotency:     ${c.idempotency}`);
  lines.push(`  Read-only:       ${c.readOnly ? "yes" : "no"}  ·  Network: ${c.reachesNetwork ? "yes" : "no"}`);
  lines.push("");
  lines.push(`  Summary:         ${c.summary}`);
  lines.push(`  Invoke when:     ${c.invokeWhen}`);
  lines.push("");
  lines.push(`  Preconditions:`);
  for (const x of c.preconditions) lines.push(`    - ${x}`);
  lines.push(`  Postconditions:`);
  for (const x of c.postconditions) lines.push(`    - ${x}`);
  lines.push(`  Side-effects:`);
  for (const x of c.sideEffects) lines.push(`    - ${x}`);
  return lines.join("\n");
}

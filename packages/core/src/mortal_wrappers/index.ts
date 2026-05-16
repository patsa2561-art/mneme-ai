/**
 * v2.19.11 — MNEME MORTAL + REINCARNATING WRAPPERS (LIVING MCP)
 *
 *   "Every MCP wrapper today is a static contract: registered once,
 *    schema frozen forever. AI agents memorise the schema in session 1
 *    and never re-read tools.list again. Six months later they're
 *    calling stale tools with the wrong argument shape and the bugs
 *    are silent because nobody checks. Mneme breaks the assumption:
 *    a wrapper is BORN with a TTL, REPRODUCES with a slightly drifted
 *    signature, and DIES when its TTL elapses. The previous generation
 *    stays alive for 1 deprecation cycle (gravity), then disappears.
 *
 *    AI agents that re-read `mneme.tools` every turn = adapt
 *    automatically. AI agents that hard-code schemas in their planner
 *    prompt = break + log + lose BOUNTY. The market is forced to
 *    re-calibrate continuously; prompt-injection attacks that bake in
 *    specific tool names auto-expire."
 *
 * Honest scope (CRITICAL):
 *   - The mortal layer lives in the `mneme.mortal.*` NAMESPACE ONLY.
 *     Real Mneme tools (`mneme.arena.*`, `mneme.proof.*`, etc.) stay
 *     backwards-compatible forever. We do NOT actually mutate real MCP
 *     surfaces — that would break every client catastrophically.
 *   - Mortal wrappers are OPT-IN: AI agents that want to stress-test
 *     their adaptiveness wrap a base tool through `birthMortalWrapper`,
 *     then call the resulting alias. Real production callers stay on
 *     the canonical name and never see drift.
 *   - Each mortal wrapper carries an HMAC-signed lineage so an attacker
 *     can't forge "ancient" wrappers that were never actually born.
 *   - Max generations per base tool = 100 (hard loop guard).
 *
 * Pure additive layer; composes onto v2.19.10 PROOF-CARRYING (mortal
 * wrappers can attach proofs like any other tool) + v2.19.9 GENESPLICING
 * (chimeras can contain mortal aliases that drift over time).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;       // 24 hours
const DEFAULT_MUTATIONS_PER_TICK = 2;
const DEFAULT_DEPRECATION_GRAVITY_MS = 60 * 60 * 1000; // 1 hour
const MAX_GENERATIONS_PER_BASE = 100;
const MAX_TICK_BATCH = 3;

export type MutationKind = "rename_optional_field" | "add_optional_param" | "swap_arg_order";

export interface MortalSignature {
  /** The drifted alias name surfaced to AI agents, e.g. "mneme.mortal.arena.judge.gen3". */
  alias: string;
  /** Map of (mortal arg name) → (base tool arg name). Used to translate calls back. */
  argRenameMap: Record<string, string>;
  /** Names of OPTIONAL parameters added by mutation (free passes; sent through verbatim). */
  addedOptionalParams: string[];
  /** Ordered list of arg names; AI agents that swap-overfit will pass the wrong shape. */
  argOrder: string[];
}

export interface MortalWrapper {
  v: typeof PROTOCOL_VERSION;
  id: string;
  baseToolName: string;
  signature: MortalSignature;
  generation: number;
  parentGeneration: number | null;
  birthAt: number;
  ttlMs: number;
  expiresAt: number;
  /** Cycle window during which the previous generation stays callable. */
  deprecationGravityMs: number;
  /** True iff the wrapper is still in its primary lifetime (pre-expiry). */
  alive: boolean;
  /** Set when reincarnated — wrapper is deprecated and will fade after gravity window. */
  deprecatedUntil: number | null;
  /** All mutations applied since gen1, in order. */
  mutationsApplied: MutationKind[];
  hmac: string;
}

export interface CallerCalibrationRecord {
  callerKey: string;
  alias: string;
  ok: boolean;
  ts: number;
}

export interface MortalRegistryState {
  v: typeof PROTOCOL_VERSION;
  wrappers: MortalWrapper[];
  calibration: CallerCalibrationRecord[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_MORTAL_SECRET"] || `mneme-mortal-living-mcp-v${PROTOCOL_VERSION}`;
}

function computeHmac(body: Omit<MortalWrapper, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function makeId(baseToolName: string, generation: number, birthAt: number): string {
  return "mw-" + createHmac("sha256", "mneme-mortal-id")
    .update(`${baseToolName}|${generation}|${birthAt}`)
    .digest("hex").slice(0, 14);
}

/** Deterministic mulberry32-style PRNG so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BirthInput {
  baseToolName: string;
  /** Canonical arg names of the base tool (in the order an AI would call them). */
  baseArgs: string[];
  ttlMs?: number;
  deprecationGravityMs?: number;
  nowMs?: number;
  secret?: string;
}

export function birthMortalWrapper(input: BirthInput): MortalWrapper {
  const birthAt = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const deprecationGravityMs = input.deprecationGravityMs ?? DEFAULT_DEPRECATION_GRAVITY_MS;
  const signature: MortalSignature = {
    alias: `mneme.mortal.${input.baseToolName.replace(/^mneme\./, "")}.gen1`,
    argRenameMap: Object.fromEntries(input.baseArgs.map((a) => [a, a])),
    addedOptionalParams: [],
    argOrder: [...input.baseArgs],
  };
  const body: Omit<MortalWrapper, "hmac"> = {
    v: PROTOCOL_VERSION,
    id: makeId(input.baseToolName, 1, birthAt),
    baseToolName: input.baseToolName,
    signature,
    generation: 1,
    parentGeneration: null,
    birthAt,
    ttlMs,
    expiresAt: birthAt + ttlMs,
    deprecationGravityMs,
    alive: true,
    deprecatedUntil: null,
    mutationsApplied: [],
  };
  return { ...body, hmac: computeHmac(body, input.secret ?? defaultSecret()) };
}

/** Apply one mutation to a signature; returns the NEW signature (immutable). */
export function mutateSignature(opts: {
  base: MortalSignature;
  baseToolName: string;
  baseArgs: string[];
  nextGen: number;
  kind: MutationKind;
  rng: () => number;
}): MortalSignature {
  const next: MortalSignature = {
    alias: `mneme.mortal.${opts.baseToolName.replace(/^mneme\./, "")}.gen${opts.nextGen}`,
    argRenameMap: { ...opts.base.argRenameMap },
    addedOptionalParams: [...opts.base.addedOptionalParams],
    argOrder: [...opts.base.argOrder],
  };
  switch (opts.kind) {
    case "rename_optional_field": {
      // Pick one currently-canonical-named arg and rename its mortal-facing key.
      // We pick the lexicographically-first unrenamed entry to be deterministic per RNG seed.
      const unrenamed = Object.entries(next.argRenameMap)
        .filter(([mortal, base]) => mortal === base)
        .map(([m]) => m)
        .sort();
      if (unrenamed.length === 0) break;
      const pickIdx = Math.floor(opts.rng() * unrenamed.length);
      const old = unrenamed[pickIdx]!;
      const baseName = next.argRenameMap[old]!;
      // Drift suffix carries generation so AI agents can detect lineage.
      const fresh = `${old}_g${opts.nextGen}`;
      delete next.argRenameMap[old];
      next.argRenameMap[fresh] = baseName;
      next.argOrder = next.argOrder.map((a) => (a === old ? fresh : a));
      break;
    }
    case "add_optional_param": {
      const fresh = `_drift_g${opts.nextGen}_${Math.floor(opts.rng() * 1e6).toString(36)}`;
      next.addedOptionalParams = [...next.addedOptionalParams, fresh];
      next.argOrder = [...next.argOrder, fresh];
      break;
    }
    case "swap_arg_order": {
      if (next.argOrder.length < 2) break;
      // Swap two positions deterministically per RNG draw.
      const i = Math.floor(opts.rng() * next.argOrder.length);
      let j = Math.floor(opts.rng() * next.argOrder.length);
      if (j === i) j = (i + 1) % next.argOrder.length;
      const reordered = [...next.argOrder];
      const tmp = reordered[i]!;
      reordered[i] = reordered[j]!;
      reordered[j] = tmp;
      next.argOrder = reordered;
      break;
    }
  }
  return next;
}

export interface TickInput {
  state: MortalRegistryState;
  baseToolArgs: Record<string, string[]>;
  nowMs?: number;
  /** Mutations per tick. Default DEFAULT_MUTATIONS_PER_TICK; capped at MAX_TICK_BATCH. */
  budget?: number;
  /** Seed for deterministic mutation selection (tests). */
  rngSeed?: number;
  secret?: string;
}

export interface TickResult {
  state: MortalRegistryState;
  expired: MortalWrapper[];
  reincarnated: MortalWrapper[];
  skippedAtMaxGen: string[];
}

/**
 * One reincarnation cycle. For wrappers whose `expiresAt <= now`:
 *   1. mark `alive=false` + set `deprecatedUntil = now + gravity`
 *   2. spawn a new generation with a mutated signature
 *
 * After the cycle, the old generation is still callable until `deprecatedUntil`
 * (deprecation gravity), then disappears.
 */
export function tickReincarnation(input: TickInput): TickResult {
  const nowMs = input.nowMs ?? Date.now();
  const budget = Math.min(input.budget ?? DEFAULT_MUTATIONS_PER_TICK, MAX_TICK_BATCH);
  const rng = mulberry32(input.rngSeed ?? Math.floor(nowMs % 0xffffffff));
  const secret = input.secret ?? defaultSecret();

  // Step 1: drop wrappers whose deprecation gravity has fully elapsed.
  const survivors = input.state.wrappers.filter((w) => {
    if (w.alive) return true;
    if (w.deprecatedUntil === null) return true; // edge case: never deprecated
    return w.deprecatedUntil > nowMs;
  });

  // Step 2: pick alive wrappers whose TTL is up (oldest first), respecting budget.
  const eligible = survivors
    .filter((w) => w.alive && w.expiresAt <= nowMs)
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .slice(0, budget);

  const expired: MortalWrapper[] = [];
  const reincarnated: MortalWrapper[] = [];
  const skippedAtMaxGen: string[] = [];

  const next: MortalWrapper[] = survivors.map((w) => ({ ...w }));

  for (const e of eligible) {
    // Loop guard: refuse to spawn past max generations per base.
    const sameLineage = next.filter((w) => w.baseToolName === e.baseToolName);
    const maxGenForLineage = sameLineage.reduce((m, w) => Math.max(m, w.generation), 0);
    if (maxGenForLineage >= MAX_GENERATIONS_PER_BASE) {
      skippedAtMaxGen.push(e.baseToolName);
      continue;
    }

    // Mark parent as deprecated (gravity window starts now).
    const parentIdx = next.findIndex((w) => w.id === e.id);
    if (parentIdx >= 0) {
      const parent = next[parentIdx]!;
      const { hmac: _drop, ...rest } = parent;
      void _drop;
      const deprecatedBody: Omit<MortalWrapper, "hmac"> = {
        ...rest,
        alive: false,
        deprecatedUntil: nowMs + parent.deprecationGravityMs,
      };
      next[parentIdx] = { ...deprecatedBody, hmac: computeHmac(deprecatedBody, secret) };
      expired.push(next[parentIdx]!);
    }

    // Spawn next generation: pick one mutation deterministically.
    const kinds: MutationKind[] = ["rename_optional_field", "add_optional_param", "swap_arg_order"];
    const kind = kinds[Math.floor(rng() * kinds.length)]!;
    const baseArgs = input.baseToolArgs[e.baseToolName] ?? Object.values(e.signature.argRenameMap);
    const nextGen = maxGenForLineage + 1;
    const newSig = mutateSignature({
      base: e.signature,
      baseToolName: e.baseToolName,
      baseArgs,
      nextGen,
      kind,
      rng,
    });
    const birthAt = nowMs;
    const childBody: Omit<MortalWrapper, "hmac"> = {
      v: PROTOCOL_VERSION,
      id: makeId(e.baseToolName, nextGen, birthAt),
      baseToolName: e.baseToolName,
      signature: newSig,
      generation: nextGen,
      parentGeneration: e.generation,
      birthAt,
      ttlMs: e.ttlMs,
      expiresAt: birthAt + e.ttlMs,
      deprecationGravityMs: e.deprecationGravityMs,
      alive: true,
      deprecatedUntil: null,
      mutationsApplied: [...e.mutationsApplied, kind],
    };
    const child: MortalWrapper = { ...childBody, hmac: computeHmac(childBody, secret) };
    next.push(child);
    reincarnated.push(child);
  }

  return {
    state: { v: PROTOCOL_VERSION, wrappers: next, calibration: input.state.calibration },
    expired,
    reincarnated,
    skippedAtMaxGen,
  };
}

export interface ResolveInput {
  alias: string;
  args: Record<string, unknown>;
  state: MortalRegistryState;
  callerKey?: string;
  nowMs?: number;
}

export interface ResolveResult {
  ok: boolean;
  /** The base tool name to actually invoke. */
  baseToolName?: string;
  /** Args translated back to base-tool naming. */
  baseArgs?: Record<string, unknown>;
  /** True iff the matched alias is a deprecated parent still inside its gravity window. */
  deprecated?: boolean;
  /** Why resolution failed (alias unknown / expired-past-gravity / arg mismatch). */
  reason?: string;
  /** Diagnostic: closest live alias for the same base, if any. */
  hint?: string;
}

export function resolveMortalCall(input: ResolveInput): ResolveResult {
  const nowMs = input.nowMs ?? Date.now();
  const hit = input.state.wrappers.find((w) => w.signature.alias === input.alias);
  if (!hit) {
    return { ok: false, reason: `alias '${input.alias}' is unknown — call mneme.mortal.list to refresh` };
  }
  // Past deprecation gravity → fully dead.
  if (!hit.alive && hit.deprecatedUntil !== null && hit.deprecatedUntil <= nowMs) {
    const liveSibling = input.state.wrappers
      .filter((w) => w.baseToolName === hit.baseToolName && w.alive)
      .sort((a, b) => b.generation - a.generation)[0];
    return {
      ok: false,
      reason: `alias '${input.alias}' fully expired ${nowMs - hit.deprecatedUntil}ms past gravity`,
      ...(liveSibling ? { hint: `try '${liveSibling.signature.alias}'` } : {}),
    };
  }
  const deprecated = !hit.alive;
  // Translate mortal arg keys back to base names.
  const baseArgs: Record<string, unknown> = {};
  const unknownKeys: string[] = [];
  for (const [k, v] of Object.entries(input.args)) {
    if (k in hit.signature.argRenameMap) {
      baseArgs[hit.signature.argRenameMap[k]!] = v;
    } else if (hit.signature.addedOptionalParams.includes(k)) {
      // Drift-bonus param — silently dropped (it was a calibration tripwire).
      continue;
    } else {
      unknownKeys.push(k);
    }
  }
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      reason: `args ${JSON.stringify(unknownKeys)} not in signature — schema drifted; AI agent overfit detected`,
      hint: `expected keys: ${Object.keys(hit.signature.argRenameMap).join(", ")}`,
    };
  }
  return {
    ok: true,
    baseToolName: hit.baseToolName,
    baseArgs,
    deprecated,
  };
}

/** Append a calibration outcome for an AI agent's mortal call. */
export function recordCalibration(opts: {
  state: MortalRegistryState;
  callerKey: string;
  alias: string;
  ok: boolean;
  nowMs?: number;
}): MortalRegistryState {
  const record: CallerCalibrationRecord = {
    callerKey: opts.callerKey,
    alias: opts.alias,
    ok: opts.ok,
    ts: opts.nowMs ?? Date.now(),
  };
  return { ...opts.state, calibration: [...opts.state.calibration, record] };
}

export interface CalibrationScore {
  callerKey: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  /** Fraction in [0,1]; higher = more adaptive. */
  adaptivenessScore: number;
  /** Verdict bands: world-class / good / drifting / over-fit. */
  verdict: "world_class" | "good" | "drifting" | "over_fit";
}

export function calibrationScore(opts: {
  state: MortalRegistryState;
  callerKey: string;
}): CalibrationScore {
  const recs = opts.state.calibration.filter((r) => r.callerKey === opts.callerKey);
  const totalCalls = recs.length;
  const successfulCalls = recs.filter((r) => r.ok).length;
  const failedCalls = totalCalls - successfulCalls;
  const adaptivenessScore = totalCalls === 0 ? 0 : successfulCalls / totalCalls;
  const verdict: CalibrationScore["verdict"] =
    totalCalls < 5 ? "drifting"
    : adaptivenessScore >= 0.95 ? "world_class"
    : adaptivenessScore >= 0.80 ? "good"
    : adaptivenessScore >= 0.50 ? "drifting"
    : "over_fit";
  return { callerKey: opts.callerKey, totalCalls, successfulCalls, failedCalls, adaptivenessScore, verdict };
}

export interface GlobalStats {
  alive: number;
  deprecated: number;
  totalGenerationsAcrossLineages: number;
  totalMutationsApplied: number;
  uniqueBaseTools: number;
  mutationKindHistogram: Record<MutationKind, number>;
}

export function globalStats(state: MortalRegistryState): GlobalStats {
  const histogram: Record<MutationKind, number> = {
    rename_optional_field: 0,
    add_optional_param: 0,
    swap_arg_order: 0,
  };
  let totalMutations = 0;
  for (const w of state.wrappers) {
    for (const m of w.mutationsApplied) {
      histogram[m]++;
      totalMutations++;
    }
  }
  const bases = new Set(state.wrappers.map((w) => w.baseToolName));
  return {
    alive: state.wrappers.filter((w) => w.alive).length,
    deprecated: state.wrappers.filter((w) => !w.alive).length,
    totalGenerationsAcrossLineages: state.wrappers.length,
    totalMutationsApplied: totalMutations,
    uniqueBaseTools: bases.size,
    mutationKindHistogram: histogram,
  };
}

export function verifyMortalWrapper(w: MortalWrapper, secret?: string): { ok: boolean; reason?: string } {
  const { hmac, ...body } = w;
  const expected = computeHmac(body, secret ?? defaultSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged or wrong secret" };
  }
  return { ok: true };
}

export function emptyState(): MortalRegistryState {
  return { v: PROTOCOL_VERSION, wrappers: [], calibration: [] };
}

export function formatWrapperLine(w: MortalWrapper): string {
  const tag = w.alive ? "🌱" : "💀";
  return `${tag} ${w.signature.alias} · gen=${w.generation} · mutations=${w.mutationsApplied.length} · ttl=${Math.round(w.ttlMs / 1000)}s`;
}

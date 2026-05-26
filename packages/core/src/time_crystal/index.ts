/**
 * v2.63.0 — TIME-CRYSTAL: federated agent wisdom.
 *
 * User-roadmap (continuing from v2.60-v2.62): conscience + **memory** +
 * diplomat + bodyguard + time machine. v2.63 ships the **memory**
 * primitive.
 *
 * When agent A encounters problem P (e.g. "Cannot find module
 * @types/node"), Mneme replies "342 agents saw this same problem in
 * the last 7 days. 89% used `npm i -D @types/node` (304 trials, Wilson
 * lower-bound 0.85). 11% tried `delete node_modules` (38 trials, but
 * 17 failed on pnpm projects)."
 *
 * Pre-MIRROR data sources for AI tooling are static (Stack Overflow,
 * GitHub Issues, docs). TIME-CRYSTAL aggregates **actual AI agent
 * behavior** — every contribution = a real agent ran a real fix and
 * got a real outcome. Every agent using Mneme MCP contributes back.
 *
 * 5 wild innovations:
 *
 *  1. CANONICAL PROBLEM FINGERPRINTING — entity slotting (`<PKG>`,
 *     `<VER>`, `<PATH>`, `<HASH>`, `<TSERR>`) + stop-word filter +
 *     token sort + SHA-256 = stable 16-hex cluster key. Two agents
 *     typing "Cannot find module '@types/node'" and "TypeScript Error
 *     TS2307: Cannot find module @types/node" cluster to ONE bucket.
 *
 *  2. WILSON LOWER-BOUND RANKING — small-sample approaches don't
 *     dominate. 2/2 success looks great until Wilson LB says 0.20.
 *     Surfaces statistically credible recommendations.
 *
 *  3. RECENCY DECAY — exponential half-life (30 days default).
 *     Old wisdom may be stale (package versions move, framework
 *     defaults change). Recent wins weigh more.
 *
 *  4. ENVIRONMENT-AWARE GROUNDING — caller passes current env
 *     (`{ node: "22.13.0", pnpm: "10" }`); ranking boosts approaches
 *     tested on matching env. Prevents "this works on Yarn but you're
 *     on pnpm" mismatches.
 *
 *  5. GOTCHA AUTO-DETECTION — when an approach has mixed outcomes,
 *     compute the env-key/value where failure-rate gain ≥ 30%.
 *     Auto-extracts "X fails on Y" patterns without anyone writing them.
 *     Plus folds free-text failure notes ("ฟังก์ชั่น break ถ้ามี
 *     pnpm-lock.yaml").
 *
 * Plus HMAC-chained ledger (same convention as PASSPORT + MIRRAGE)
 * for tamper-evident contribution history; opt-in cross-host gossip
 * via CONSENT FABRIC (wire pending v2.64+).
 *
 * Pure ESM. Defensive — never throws.
 */

import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { normalizeProblem, similarity } from "./problem_fingerprint.js";
import { rankApproaches, type WisdomRecord, type ApproachGroup, type RankOpts, type Outcome } from "./ranking.js";
import { detectGotchas, type Gotcha } from "./gotcha_detector.js";

const KEY_ENV = "MNEME_TIME_CRYSTAL_KEY";
const DEFAULT_KEY = "mneme-time-crystal-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export interface ContributionInput {
  /** Free-text problem description (will be fingerprinted). */
  problem: string;
  /** Free-text description of what the agent tried. */
  approach: string;
  /** Outcome — success/failure/partial. */
  outcome: Outcome;
  /** Reporting agent id (for distinct-contributor count). */
  agent: string;
  /** Optional environment map (node, pnpm, framework versions). */
  env?: Record<string, string>;
  /** Optional free-text gotcha hint. */
  note?: string;
  /** Working directory. */
  cwd?: string;
}

export interface ContributionResult {
  ok: boolean;
  recordId: string;
  problemFingerprint: string;
  hmac: string;
  hint: string;
}

export interface LookupInput {
  problem: string;
  /** Optional env to filter / boost ranking. */
  env?: Record<string, string>;
  /** Max approaches to return. */
  topN?: number;
  /** Working directory. */
  cwd?: string;
  /** Recency half-life override (ms). Default 30 days. */
  halfLifeMs?: number;
  /** Reference "now" for deterministic tests. */
  now?: number;
}

export interface LookupResult {
  problem: string;
  problemFingerprint: string;
  totalContributors: number;
  distinctAgents: number;
  approaches: ApproachGroup[];
  gotchas: Gotcha[];
  /** Similar (but not identical) problem fingerprints with cross-bucket overlap. */
  related: Array<{ fingerprint: string; canonical: string; similarity: number; sampleSize: number }>;
  /** Plain-English summary suitable for an agent to read. */
  summary: string;
  at: string;
  hmac: string;
}

/* ── Canonical JSON HMAC ────────────────────────────────────────── */

function canonicalJson(o: unknown): string {
  if (o === undefined) return "null";
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  const entries = Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function signHmac(body: unknown): string {
  return createHmac("sha256", keyOf()).update(canonicalJson(body)).digest("hex");
}

/* ── Wisdom ledger (HMAC-chained jsonl) ─────────────────────────── */

interface LedgerEntry {
  kind: "contribution";
  at: string;
  recordId: string;
  agent: string;
  problemFingerprint: string;
  canonical: string;
  approach: string;
  outcome: Outcome;
  env?: Record<string, string>;
  note?: string;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "time_crystal", "wisdom.jsonl");
}

function readLedgerLines(cwd: string): string[] {
  try {
    return readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0);
  } catch { return []; }
}

function lastLedgerHmac(cwd: string): string {
  const lines = readLedgerLines(cwd);
  if (lines.length === 0) return "";
  try { return (JSON.parse(lines[lines.length - 1]!) as LedgerEntry).hmac; }
  catch { return ""; }
}

export function readLedger(cwd: string): LedgerEntry[] {
  return readLedgerLines(cwd).map((l) => {
    try { return JSON.parse(l) as LedgerEntry; } catch { return null; }
  }).filter((x): x is LedgerEntry => x !== null);
}

export function verifyLedgerChain(cwd: string): { ok: boolean; rows: number; brokenAt?: number } {
  const lines = readLedger(cwd);
  let prevHmac = "";
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]!;
    if (row.prevHmac !== prevHmac) return { ok: false, rows: i, brokenAt: i };
    const { hmac, ...body } = row;
    const expected = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i };
    prevHmac = hmac;
  }
  return { ok: true, rows: lines.length };
}

/* ── Contribute ─────────────────────────────────────────────────── */

export function contribute(input: ContributionInput): ContributionResult {
  const cwd = input.cwd ?? process.cwd();
  const norm = normalizeProblem(input.problem);
  const recordId = randomBytes(8).toString("hex");
  const at = new Date().toISOString();
  const prevHmac = lastLedgerHmac(cwd);
  const body: Omit<LedgerEntry, "hmac"> = {
    kind: "contribution",
    at, recordId, agent: input.agent,
    problemFingerprint: norm.fingerprint,
    canonical: norm.canonical,
    approach: input.approach,
    outcome: input.outcome,
    env: input.env,
    note: input.note,
    prevHmac,
  };
  const hmac = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
  const entry: LedgerEntry = { ...body, hmac };
  try {
    mkdirSync(dirname(ledgerPath(cwd)), { recursive: true });
    appendFileSync(ledgerPath(cwd), JSON.stringify(entry) + "\n");
  } catch { /* noop */ }
  return {
    ok: true,
    recordId,
    problemFingerprint: norm.fingerprint,
    hmac,
    hint: `contributed: agent=${input.agent} outcome=${input.outcome} fingerprint=${norm.fingerprint}`,
  };
}

/* ── Lookup ─────────────────────────────────────────────────────── */

export function lookupWisdom(input: LookupInput): LookupResult {
  const cwd = input.cwd ?? process.cwd();
  const norm = normalizeProblem(input.problem);
  const all = readLedger(cwd);
  const exact = all.filter((e) => e.problemFingerprint === norm.fingerprint);

  // Build records for ranking.
  const records: WisdomRecord[] = exact.map((e) => ({
    approach: e.approach,
    outcome: e.outcome,
    at: e.at,
    env: e.env,
    note: e.note,
  }));

  const approaches = rankApproaches(records, {
    env: input.env,
    halfLifeMs: input.halfLifeMs,
    now: input.now,
  }).slice(0, input.topN ?? 5);
  const gotchas = detectGotchas(records);

  // Related: distinct fingerprints with >0.30 token-set similarity.
  const byFingerprint = new Map<string, LedgerEntry[]>();
  for (const e of all) {
    if (e.problemFingerprint === norm.fingerprint) continue;
    const list = byFingerprint.get(e.problemFingerprint) ?? [];
    list.push(e);
    byFingerprint.set(e.problemFingerprint, list);
  }
  const related: LookupResult["related"] = [];
  for (const [fp, list] of byFingerprint) {
    const sim = similarity(norm.canonical, list[0]!.canonical);
    if (sim >= 0.30) {
      related.push({ fingerprint: fp, canonical: list[0]!.canonical, similarity: +sim.toFixed(3), sampleSize: list.length });
    }
  }
  related.sort((a, b) => b.similarity - a.similarity);

  const distinctAgents = new Set(exact.map((e) => e.agent)).size;
  const at = new Date().toISOString();

  // Plain-English summary suitable for the agent to read inline.
  const summaryLines: string[] = [];
  if (exact.length === 0) {
    summaryLines.push(`No prior wisdom on this exact problem fingerprint (${norm.fingerprint}).`);
    if (related.length > 0) summaryLines.push(`But ${related.length} similar bucket(s) exist — top: "${related[0]!.canonical.slice(0, 80)}".`);
  } else {
    summaryLines.push(`${exact.length} contribution(s) from ${distinctAgents} distinct agent(s) on this problem.`);
    for (const a of approaches.slice(0, 3)) {
      const pct = (a.successRate * 100).toFixed(0);
      const lb = (a.wilsonLB * 100).toFixed(0);
      summaryLines.push(`  • ${a.approach}: ${pct}% success (n=${a.sampleSize}, Wilson-LB ${lb}%)`);
    }
    if (gotchas.length > 0) {
      summaryLines.push(`gotchas: ${gotchas.slice(0, 2).map((g) => g.approach + (g.triggerConditions.length > 0 ? ` (fails on ${g.triggerConditions[0]!.key}=${g.triggerConditions[0]!.value})` : "")).join("; ")}`);
    }
  }
  const summary = summaryLines.join("\n");

  const bodyForHmac = {
    problem: input.problem,
    problemFingerprint: norm.fingerprint,
    totalContributors: exact.length,
    distinctAgents,
    approaches, gotchas, related, summary, at,
  };
  const hmac = signHmac(bodyForHmac);
  return { ...bodyForHmac, hmac };
}

export function verifyLookup(r: LookupResult): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  return signHmac(body) === hmac;
}

/* ── Contributor stats ──────────────────────────────────────────── */

export interface ContributorStats {
  totalContributions: number;
  distinctAgents: number;
  distinctProblems: number;
  /** Top 10 agents by contribution count. */
  topAgents: Array<{ agent: string; count: number }>;
  /** Top 10 most-discussed problem fingerprints. */
  topProblems: Array<{ fingerprint: string; canonical: string; count: number }>;
  /** Distribution of outcomes. */
  outcomes: Record<Outcome, number>;
}

export function contributorStats(cwd: string): ContributorStats {
  const rows = readLedger(cwd);
  const agentCount = new Map<string, number>();
  const problemCount = new Map<string, { canonical: string; count: number }>();
  const outcomes: Record<Outcome, number> = { success: 0, failure: 0, partial: 0 };
  for (const r of rows) {
    agentCount.set(r.agent, (agentCount.get(r.agent) ?? 0) + 1);
    const p = problemCount.get(r.problemFingerprint) ?? { canonical: r.canonical, count: 0 };
    p.count++;
    problemCount.set(r.problemFingerprint, p);
    outcomes[r.outcome]++;
  }
  return {
    totalContributions: rows.length,
    distinctAgents: agentCount.size,
    distinctProblems: problemCount.size,
    topAgents: Array.from(agentCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([agent, count]) => ({ agent, count })),
    topProblems: Array.from(problemCount.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([fingerprint, { canonical, count }]) => ({ fingerprint, canonical, count })),
    outcomes,
  };
}

/* ── Render ─────────────────────────────────────────────────────── */

export function renderLookupBanner(r: LookupResult): string {
  const lines = [
    `🌌 TIME-CRYSTAL · fingerprint ${r.problemFingerprint}`,
    `   ${r.totalContributors} contribution(s) · ${r.distinctAgents} distinct agent(s)`,
    "",
  ];
  for (const a of r.approaches) {
    const pct = (a.successRate * 100).toFixed(0);
    const lb = (a.wilsonLB * 100).toFixed(0);
    lines.push(`   ★ rank=${a.rankScore.toFixed(3)}  ${pct}% success  Wilson-LB ${lb}%  n=${a.sampleSize}`);
    lines.push(`      ${a.approach}`);
    if (a.notes.length > 0) lines.push(`      note: ${a.notes[0]}`);
  }
  if (r.gotchas.length > 0) {
    lines.push("");
    lines.push(`   GOTCHAS (${r.gotchas.length}):`);
    for (const g of r.gotchas.slice(0, 3)) {
      const cond = g.triggerConditions.length > 0
        ? `fails on ${g.triggerConditions.map((t) => `${t.key}=${t.value}`).join(", ")}`
        : g.notes.join("; ");
      lines.push(`     ⚠ ${g.approach} — ${cond} (severity ${(g.severity * 100).toFixed(0)}%)`);
    }
  }
  if (r.related.length > 0) {
    lines.push("");
    lines.push(`   RELATED (${r.related.length}):`);
    for (const rel of r.related.slice(0, 3)) {
      lines.push(`     ~ ${(rel.similarity * 100).toFixed(0)}% match  ${rel.canonical.slice(0, 80)}  (n=${rel.sampleSize})`);
    }
  }
  return lines.join("\n");
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export { normalizeProblem, similarity } from "./problem_fingerprint.js";
export type { NormalizationResult } from "./problem_fingerprint.js";
export { rankApproaches, approachKey } from "./ranking.js";
export type { WisdomRecord, ApproachGroup, RankOpts, Outcome } from "./ranking.js";
export { detectGotchas } from "./gotcha_detector.js";
export type { Gotcha } from "./gotcha_detector.js";

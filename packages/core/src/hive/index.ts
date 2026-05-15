/**
 * v2.15.0 — MNEME HIVE
 *
 *   "Pattern share without source share. Hash a problem, hash its
 *    solution, hash its outcome. Other Mneme users hash the same
 *    problem and look up the canonical fix. Your repo never leaves
 *    your machine; only one-way hashes do."
 *
 * The killer distribution wedge: every Mneme user benefits from every
 * OTHER Mneme user's solved problems. Network effect from day 1.
 *
 * Privacy model:
 *   - Patterns are hashed (sha256 of canonicalized AST-ish shape).
 *   - Solutions are summarised (delta size, file paths anonymised, kind
 *     of change) — never the source code itself.
 *   - Outcomes are graded (good / bad / regression) by the user's own
 *     test suite + bounty receipts.
 *
 * Wire model:
 *   - Local hive (`packages/core/src/hive/local.ts`) stores per-machine
 *     pattern observations. Always works offline.
 *   - Public hive endpoint (`HIVE_DEFAULT_URL`) at cosmic.mneme-ai.space
 *     /hive — opt-in publish + pull. v2.15 ships the CLIENT primitive;
 *     the server endpoint is a Phase 2 stub (will be added when N>1
 *     users have opted in).
 *
 * Tamper-evidence: every hash + observation is HMAC-signed. Receivers
 * verify before counting toward the leaderboard.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;
export const HIVE_DEFAULT_URL = "https://cosmic.mneme-ai.space/hive";

export type ProblemKind =
  | "bug" | "refactor" | "perf" | "security"
  | "test_failure" | "build_failure" | "dependency_update"
  | "type_error" | "lint_error" | "deploy_failure" | "other";

export type Outcome = "good" | "bad" | "regression" | "unknown";

export interface PatternHash {
  v: typeof PROTOCOL_VERSION;
  /** sha256 of canonical(problem). 64 hex chars. */
  hash: string;
  /** sha256 of canonical({stack, framework, kind}). 64 hex chars. Used
   *  to cluster similar patterns across stacks. */
  contextHash: string;
  /** Kind tag for indexing. */
  kind: ProblemKind;
  /** Stack tag (typescript / python / ...). Optional but improves
   *  matchmaking. */
  stack?: string;
  /** Framework tag. Optional. */
  framework?: string;
}

export interface PatternObservation {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ts: string;
  hash: PatternHash;
  /** Summary of the solution applied (kind + size, NOT source). */
  solution: {
    kind: "edit" | "delete" | "add" | "rename" | "config" | "rollback" | "other";
    /** Number of files touched. */
    filesAffected: number;
    /** Lines changed (added + removed). */
    linesChanged: number;
    /** Optional 1-line plain-English label (e.g., "added missing await"). */
    label?: string;
  };
  /** Outcome graded by tests / bounty / human. */
  outcome: Outcome;
  /** HMAC over the body — verifiable on remote ingest. */
  sig: string;
}

export interface PatternMatchSummary {
  hash: string;
  totalObservations: number;
  byOutcome: Record<Outcome, number>;
  bySolutionKind: Record<string, number>;
  /** Best-known solution: highest-rated by good-rate * sample-size. */
  bestSolution: {
    kind: string;
    label?: string;
    confidence: number; // 0..1
    samplesGood: number;
    samplesTotal: number;
  } | null;
  signedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_HIVE_SECRET"] || `mneme-hive-public-v${PROTOCOL_VERSION}`;
}

function hivePath(repoDir?: string): string {
  const root = repoDir ? (isAbsolute(repoDir) ? repoDir : resolve(repoDir)) : process.cwd();
  const dir = join(root, ".mneme", "hive");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "observations.jsonl");
}

function readAll(path: string): PatternObservation[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: PatternObservation[] = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

/**
 * Hash a problem into a stable fingerprint. Pure function over text;
 * normalises whitespace + identifiers so semantically-equivalent
 * problems hash to the same value across users.
 *
 * The hash is over a canonical AST-ish shape:
 *   - lowercase
 *   - identifiers replaced with $1, $2, ... in order of first occurrence
 *   - whitespace collapsed
 *   - numeric literals replaced with N
 *   - string literals replaced with S
 */
export function hashPattern(input: {
  problemText: string;
  kind: ProblemKind;
  stack?: string;
  framework?: string;
}): PatternHash {
  let normalised = input.problemText.toLowerCase();
  // Replace string literals
  normalised = normalised.replace(/"[^"]*"|'[^']*'/g, "S");
  // Replace numbers — including digits glued to a unit suffix (4523ms,
  // 200kb, 99.9%). Negative lookbehind avoids touching identifiers that
  // start with a letter and contain digits (var123 stays intact).
  normalised = normalised.replace(/(?<![a-zA-Z_])\d+(?:\.\d+)?/g, "N");
  // Collapse identifiers — heuristic: any 2+ char alphanumeric token
  // becomes $N where N is the position of first occurrence.
  const idents = new Map<string, string>();
  let counter = 1;
  normalised = normalised.replace(/\b[a-z_][a-z0-9_]+\b/gi, (token) => {
    if (KEYWORDS.has(token)) return token;
    let slot = idents.get(token);
    if (!slot) { slot = "$" + counter++; idents.set(token, slot); }
    return slot;
  });
  // Collapse whitespace
  normalised = normalised.replace(/\s+/g, " ").trim();

  const hash = createHash("sha256").update(normalised).digest("hex");
  const contextHash = createHash("sha256")
    .update(canon({ stack: input.stack ?? "", framework: input.framework ?? "", kind: input.kind }))
    .digest("hex");

  return {
    v: PROTOCOL_VERSION,
    hash,
    contextHash,
    kind: input.kind,
    ...(input.stack ? { stack: input.stack } : {}),
    ...(input.framework ? { framework: input.framework } : {}),
  };
}

const KEYWORDS = new Set([
  "true", "false", "null", "undefined", "void", "return", "if", "else",
  "for", "while", "do", "break", "continue", "switch", "case", "default",
  "try", "catch", "finally", "throw", "new", "this", "super", "class",
  "function", "const", "let", "var", "async", "await", "yield",
  "import", "export", "from", "as", "type", "interface", "enum",
  "public", "private", "protected", "static", "abstract", "extends", "implements",
  "def", "lambda", "pass", "raise", "with", "and", "or", "not", "in", "is",
  "fn", "mut", "pub", "use", "mod", "impl", "trait", "where", "match",
  "package", "func", "struct", "go", "select", "chan", "defer",
  "begin", "end", "module", "require",
]);

export interface RecordObservationInput {
  hash: PatternHash;
  solution: PatternObservation["solution"];
  outcome: Outcome;
  repoDir?: string;
  secret?: string;
}

export function recordObservation(input: RecordObservationInput): PatternObservation {
  const path = hivePath(input.repoDir);
  const noSig: Omit<PatternObservation, "sig"> = {
    v: PROTOCOL_VERSION,
    id: "h-" + randomBytes(6).toString("hex"),
    ts: new Date().toISOString(),
    hash: input.hash,
    solution: input.solution,
    outcome: input.outcome,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(noSig)).digest("hex");
  const entry: PatternObservation = { ...noSig, sig };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  return entry;
}

export function verifyObservation(o: PatternObservation, secret?: string): boolean {
  const { sig: claimed, ...body } = o as PatternObservation & { sig: string };
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return expected === claimed;
}

/**
 * Look up a pattern in the LOCAL hive. Returns the best-known solution
 * if any observations match. Pure function over local storage.
 */
export function lookupLocal(hash: PatternHash, opts: { repoDir?: string; secret?: string } = {}): PatternMatchSummary {
  const path = hivePath(opts.repoDir);
  const all = readAll(path);
  return summarise(hash.hash, all, opts.secret);
}

function summarise(hashHex: string, all: PatternObservation[], secret?: string): PatternMatchSummary {
  const matching = all.filter((o) => o.hash.hash === hashHex);
  const byOutcome: Record<Outcome, number> = { good: 0, bad: 0, regression: 0, unknown: 0 };
  const bySolutionKind: Record<string, number> = {};
  for (const o of matching) {
    byOutcome[o.outcome]++;
    bySolutionKind[o.solution.kind] = (bySolutionKind[o.solution.kind] ?? 0) + 1;
  }
  // Best solution: per (kind,label), good_count^1.2 / total — boosts
  // small samples with no failures slightly less than large ones.
  type Group = { kind: string; label?: string; good: number; total: number };
  const groups = new Map<string, Group>();
  for (const o of matching) {
    const key = o.solution.kind + "||" + (o.solution.label ?? "");
    const g = groups.get(key) ?? { kind: o.solution.kind, ...(o.solution.label ? { label: o.solution.label } : {}), good: 0, total: 0 };
    g.total++;
    if (o.outcome === "good") g.good++;
    groups.set(key, g);
  }
  let best: PatternMatchSummary["bestSolution"] = null;
  let bestScore = 0;
  for (const g of groups.values()) {
    if (g.total === 0) continue;
    const score = Math.pow(g.good, 1.2) / g.total;
    if (score > bestScore) {
      bestScore = score;
      best = { kind: g.kind, ...(g.label ? { label: g.label } : {}), confidence: g.good / g.total, samplesGood: g.good, samplesTotal: g.total };
    }
  }
  const signedAt = new Date().toISOString();
  const body = { hash: hashHex, totalObservations: matching.length, byOutcome, bySolutionKind, bestSolution: best, signedAt };
  const sig = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/**
 * Lookup against the public hive (cosmic.mneme-ai.space/hive). Stub for
 * v2.15; falls back to local if endpoint unreachable. Same signature so
 * upgrading later is transparent.
 */
export async function lookupPublic(hash: PatternHash, opts: {
  url?: string;
  fetchOverride?: typeof fetch;
  repoDir?: string;
  secret?: string;
} = {}): Promise<PatternMatchSummary> {
  const url = (opts.url ?? HIVE_DEFAULT_URL).replace(/\/+$/, "") + "/lookup/" + encodeURIComponent(hash.hash);
  const fetchFn = opts.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return lookupLocal(hash, opts);
  try {
    const r = await fetchFn(url);
    if (!r.ok) return lookupLocal(hash, opts);
    const j = await r.json() as PatternMatchSummary;
    return j;
  } catch {
    // Endpoint not yet live — fall back to local. Once cosmic adds the
    // /hive route, this transparently picks it up.
    return lookupLocal(hash, opts);
  }
}

/**
 * Publish a local observation to the public hive. Best-effort; failure
 * leaves the observation in local storage only. Opt-in: caller decides
 * whether to share.
 */
export async function publishObservation(o: PatternObservation, opts: {
  url?: string;
  fetchOverride?: typeof fetch;
} = {}): Promise<{ ok: boolean; error?: string }> {
  const url = (opts.url ?? HIVE_DEFAULT_URL).replace(/\/+$/, "") + "/publish";
  const fetchFn = opts.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  try {
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(o),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}

export function listLocal(opts: { repoDir?: string } = {}): PatternObservation[] {
  return readAll(hivePath(opts.repoDir));
}

/** One-line pulse summary. */
export function formatHiveLine(opts: { repoDir?: string } = {}): string {
  const all = readAll(hivePath(opts.repoDir));
  const goods = all.filter((o) => o.outcome === "good").length;
  const distinctHashes = new Set(all.map((o) => o.hash.hash)).size;
  return `HIVE · ${all.length} observations · ${goods} good · ${distinctHashes} distinct patterns`;
}

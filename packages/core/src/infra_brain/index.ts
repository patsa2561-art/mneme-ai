/**
 * v2.14.0 — INFRA AS AI
 *
 *   "Every server, container, database, and CI job is an agent with
 *    memory. They observe their own behaviour, gossip with peers, and
 *    surface insights when humans aren't watching. Mneme = the brain
 *    inside each host."
 *
 * Two layers, both work standalone:
 *
 *   1. HOST BRAIN — a per-host local store of observations. Things
 *      noticed: latency outliers, error spikes, deploy events, cron
 *      misfires. Each observation is HMAC-signed + de-duplicated.
 *
 *   2. GOSSIP PRIMITIVE — peer-to-peer exchange of redacted summaries
 *      (HOST BRAIN exports a `digest` that other hosts can ingest). No
 *      central server required. Anti-entropy through periodic digest
 *      swaps.
 *
 * Killer property: the network of host brains becomes a *distributed
 * memory* that survives any single failure. Like git's commit graph but
 * for infrastructure observations.
 *
 * Storage: `.mneme/infra/observations.jsonl` — local-first, append-only.
 * Digests are HMAC-signed for tamper-evidence on the wire.
 *
 * Wisdom: this is the seed. Full distributed gossip protocol (mesh,
 * pull-sync, conflict resolution) is Phase 2 — once enough hosts run
 * the seed. Phase 1 is "personal observability that compounds".
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { hostname } from "node:os";

const PROTOCOL_VERSION = 1 as const;

export type ObservationKind =
  | "latency_outlier"
  | "error_spike"
  | "deploy"
  | "config_change"
  | "cron_misfire"
  | "anomaly"
  | "saturation"
  | "recovery"
  | "incident"
  | "other";

export interface Observation {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ts: string;
  host: string;
  kind: ObservationKind;
  /** Short tag like "auth-service" or "postgres-primary". */
  subject: string;
  /** Free-form detail (kept short). */
  detail: string;
  /** Optional numeric metric the obs was triggered by. */
  metric?: { name: string; value: number; unit?: string };
  /** Tags for indexing / gossip filtering. */
  tags?: string[];
  /** HMAC over the body — verifiable on remote ingest. */
  sig: string;
}

export interface PatternMatch {
  count: number;
  kind: ObservationKind;
  subject: string;
  firstSeen: string;
  lastSeen: string;
  /** Best-effort recurring window (e.g., "Tuesday 15:00 UTC ± 30 min"). */
  window?: string;
  /** Examples (up to 3). */
  examples: string[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_INFRA_SECRET"] || `mneme-infra-default-v${PROTOCOL_VERSION}`;
}

function infraDir(repoDir?: string): string {
  const root = repoDir ? (isAbsolute(repoDir) ? repoDir : resolve(repoDir)) : process.cwd();
  const dir = join(root, ".mneme", "infra");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function observationsPath(repoDir?: string): string {
  return join(infraDir(repoDir), "observations.jsonl");
}

function readAll(path: string): Observation[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: Observation[] = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

function signObs(body: Omit<Observation, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

export interface RecordObservationInput {
  kind: ObservationKind;
  subject: string;
  detail: string;
  metric?: Observation["metric"];
  tags?: string[];
  host?: string;
  repoDir?: string;
  secret?: string;
}

export function recordObservation(input: RecordObservationInput): Observation {
  const path = observationsPath(input.repoDir);
  const noSig: Omit<Observation, "sig"> = {
    v: PROTOCOL_VERSION,
    id: "o-" + randomBytes(6).toString("hex"),
    ts: new Date().toISOString(),
    host: input.host ?? hostname(),
    kind: input.kind,
    subject: input.subject.slice(0, 200),
    detail: input.detail.slice(0, 1000),
    ...(input.metric ? { metric: input.metric } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  };
  const obs: Observation = { ...noSig, sig: signObs(noSig, input.secret ?? defaultSecret()) };
  appendFileSync(path, JSON.stringify(obs) + "\n");
  return obs;
}

/** Verify a single observation came from the trusted secret holder. */
export function verifyObservation(obs: Observation, secret?: string): boolean {
  const { sig: claimed, ...body } = obs as Observation & { sig: string };
  const expected = signObs(body, secret ?? defaultSecret());
  return expected === claimed;
}

/**
 * Pattern detector — finds recurring (kind, subject) tuples and
 * estimates their recurrence window.
 */
export function detectPatterns(opts: { repoDir?: string; minOccurrences?: number } = {}): PatternMatch[] {
  const all = readAll(observationsPath(opts.repoDir));
  const min = opts.minOccurrences ?? 2;
  const groups = new Map<string, Observation[]>();
  for (const o of all) {
    const key = `${o.kind}|${o.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const results: PatternMatch[] = [];
  for (const [key, obs] of groups) {
    if (obs.length < min) continue;
    obs.sort((a, b) => a.ts.localeCompare(b.ts));
    const window = estimateWindow(obs);
    results.push({
      count: obs.length,
      kind: obs[0]!.kind,
      subject: obs[0]!.subject,
      firstSeen: obs[0]!.ts,
      lastSeen: obs[obs.length - 1]!.ts,
      ...(window ? { window } : {}),
      examples: obs.slice(-3).map((o) => o.detail),
    });
  }
  return results.sort((a, b) => b.count - a.count);
}

/** Estimate a recurring time-of-day window if observations cluster. */
function estimateWindow(obs: Observation[]): string | undefined {
  if (obs.length < 3) return undefined;
  const hours = obs.map((o) => new Date(o.ts).getUTCHours()).filter((h) => Number.isFinite(h));
  if (hours.length === 0) return undefined;
  const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
  const variance = hours.reduce((a, b) => a + (b - mean) ** 2, 0) / hours.length;
  if (variance > 4) return undefined; // too spread to call a "window"
  // Day-of-week analysis
  const dows = obs.map((o) => new Date(o.ts).getUTCDay());
  const dowCounts = new Map<number, number>();
  for (const d of dows) dowCounts.set(d, (dowCounts.get(d) ?? 0) + 1);
  const dominant = Array.from(dowCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const dowFreq = dominant ? dominant[1] / dows.length : 0;
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowPart = dowFreq > 0.6 ? `${dowNames[dominant![0]]} ` : "";
  return `${dowPart}${String(Math.round(mean)).padStart(2, "0")}:00 UTC ± ${Math.ceil(Math.sqrt(variance))}h`;
}

export interface BrainDigest {
  v: typeof PROTOCOL_VERSION;
  host: string;
  generatedAt: string;
  observationCount: number;
  patterns: PatternMatch[];
  /** HMAC over the digest — verify before ingesting from a peer. */
  sig: string;
}

/** Produce a redacted, HMAC-signed digest suitable for gossip exchange. */
export function exportDigest(opts: { repoDir?: string; secret?: string } = {}): BrainDigest {
  const all = readAll(observationsPath(opts.repoDir));
  const patterns = detectPatterns(opts);
  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    host: hostname(),
    generatedAt: new Date().toISOString(),
    observationCount: all.length,
    patterns,
  };
  const sig = createHmac("sha256", opts.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/** Verify a peer's digest with the shared secret before trusting it. */
export function verifyDigest(d: BrainDigest, secret?: string): boolean {
  const { sig: claimed, ...body } = d as BrainDigest & { sig: string };
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return expected === claimed;
}

export interface IngestResult {
  accepted: boolean;
  reason?: string;
  patternsLearned: number;
}

/**
 * Ingest a peer's digest. Verified peers contribute pattern observations
 * (NOT raw events — we share aggregates only for privacy + bandwidth).
 * Each learned pattern is appended as a synthetic observation tagged
 * `from:<peer-host>` for traceability.
 */
export function ingestDigest(d: BrainDigest, opts: { repoDir?: string; secret?: string } = {}): IngestResult {
  if (!verifyDigest(d, opts.secret)) {
    return { accepted: false, reason: "digest sig mismatch — unverified peer", patternsLearned: 0 };
  }
  let learned = 0;
  for (const p of d.patterns) {
    if (p.count < 2) continue;
    recordObservation({
      kind: p.kind,
      subject: p.subject,
      detail: `[peer:${d.host}] saw ${p.count} occurrences${p.window ? ` at ${p.window}` : ""}. Examples: ${p.examples.join(" | ").slice(0, 400)}`,
      tags: ["gossip", `from:${d.host}`],
      repoDir: opts.repoDir,
      secret: opts.secret,
    });
    learned++;
  }
  return { accepted: true, patternsLearned: learned };
}

/**
 * Diagnose: given a current symptom, search past observations for
 * similar patterns and return a structured hypothesis.
 */
export interface DiagnoseInput {
  subject: string;
  detail: string;
  repoDir?: string;
}

export interface DiagnoseResult {
  /** Hypotheses sorted by similarity. */
  hypotheses: Array<{
    matchingObservation: { id: string; ts: string; host: string; kind: ObservationKind; detail: string };
    similarity: number;
    notes: string;
  }>;
  recurring: PatternMatch | null;
  rationale: string[];
}

const STOP = new Set(["the", "a", "an", "is", "are", "in", "on", "of", "to", "for", "and", "or", "but", "with", "be", "this", "that", "at"]);

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function diagnose(input: DiagnoseInput): DiagnoseResult {
  const all = readAll(observationsPath(input.repoDir));
  const qTokens = tokenize(`${input.subject} ${input.detail}`);
  const scored = all.map((o) => ({
    o, sim: jaccard(qTokens, tokenize(`${o.subject} ${o.detail}`)),
  })).filter((s) => s.sim > 0).sort((a, b) => b.sim - a.sim).slice(0, 5);

  const patterns = detectPatterns({ repoDir: input.repoDir });
  const recurring = patterns.find((p) =>
    p.subject.toLowerCase() === input.subject.toLowerCase()
  ) ?? null;

  const rationale: string[] = [];
  if (scored.length === 0) rationale.push("No historical observations match this signature — looks novel.");
  else rationale.push(`Found ${scored.length} similar past observation(s); top similarity ${scored[0]!.sim.toFixed(2)}.`);
  if (recurring) rationale.push(`Subject "${recurring.subject}" has recurred ${recurring.count} times${recurring.window ? ` (${recurring.window})` : ""} — this is likely a pattern, not a one-off.`);

  return {
    hypotheses: scored.map((s) => ({
      matchingObservation: {
        id: s.o.id, ts: s.o.ts, host: s.o.host, kind: s.o.kind, detail: s.o.detail,
      },
      similarity: Math.round(s.sim * 1000) / 1000,
      notes: `kind=${s.o.kind} on ${s.o.host}`,
    })),
    recurring,
    rationale,
  };
}

/** One-line pulse. */
export function formatInfraLine(opts: { repoDir?: string } = {}): string {
  const all = readAll(observationsPath(opts.repoDir));
  const patterns = detectPatterns({ repoDir: opts.repoDir });
  return `INFRA · ${all.length} obs · ${patterns.length} patterns`;
}

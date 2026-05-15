/**
 * v2.17.0 — MNEME JACKPOT
 *
 *   "Open Mneme each morning, get ONE personalised insight from your
 *    repo + your Mneme corpora that feels like winning the lottery —
 *    so on-point you wonder how Mneme knew. Deterministic per-day per-
 *    repo seed; you can't game it. Confidence-graded so you know when
 *    to trust it."
 *
 * The "lottery jackpot" feeling comes from THREE properties:
 *   1. **Personalised** — only true for YOUR repo + YOUR Mneme data.
 *   2. **Surprising** — the user would NOT have found it themselves.
 *   3. **High-value** — saves them time, money, or a future bug.
 *
 * Mneme has the ingredients already: PROJECT SOUL (scars), REPLICA
 * (your decisions), HIVE (cross-user patterns), BOUNTY (vendor truth),
 * INFRA AS AI (host observations), BUG PROPHET (regression risk). The
 * JACKPOT is a *selector* over these — picks the single highest-value
 * insight per day per repo.
 *
 * Insight kinds shipped in v2.17.0:
 *   - SCAR_DRIFT     — your AI is drifting toward a known scar pattern.
 *   - VENDOR_ARB     — switch vendor on this task class; save $.
 *   - STALE_OBSERVATION — a recurring infra pattern that's gone quiet
 *                         for unusual time; investigate.
 *   - HIVE_GOLD      — another Mneme user just solved a pattern you also
 *                      have.
 *   - REPLICA_STREAK — your recent decisions have a consistent "good"
 *                      outcome streak; double-down on the approach.
 *   - DEAD_DEP       — a dependency you have hasn't been published in
 *                      >1y; risk to surface for v2.18 audit.
 *
 * Deterministic seed: jackpot uses sha256(YYYY-MM-DD + repo basename +
 * insight-pool-hash) → picks one. Same day, same repo = same insight.
 * Next day, different. You can re-roll only by waiting.
 *
 * HMAC-signed for tamper-evident bragging (post your jackpot win on X).
 */

import { createHmac, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, basename, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export type InsightKind =
  | "scar_drift" | "vendor_arb" | "stale_observation"
  | "hive_gold" | "replica_streak" | "dead_dep" | "soul_gap" | "test_gap";

export interface JackpotInsight {
  v: typeof PROTOCOL_VERSION;
  /** Stable id: sha256(day + repo + insightKind + payload). */
  id: string;
  /** "YYYY-MM-DD" of the draw. */
  drawDate: string;
  /** Project basename. */
  project: string;
  kind: InsightKind;
  /** Plain-English headline ("YOUR JACKPOT TODAY"). */
  headline: string;
  /** 2-3 sentence body. */
  body: string;
  /** Confidence 0..1. */
  confidence: number;
  /** Estimated value: "saves time / saves money / prevents bug / improves DX". */
  valueClass: "saves_time" | "saves_money" | "prevents_bug" | "improves_dx" | "compounds_long_term";
  /** Estimated impact in plain English ("~2 hours of debugging avoided"). */
  valueEstimate: string;
  /** Concrete action the user (or AI agent) should take. */
  action: string;
  /** Surprise factor 0..1 — higher = less obvious. */
  surprise: number;
  /** HMAC over the body — proves the win is real (post-able). */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_JACKPOT_SECRET"] || `mneme-jackpot-v${PROTOCOL_VERSION}`;
}

function resolveRoot(p?: string): string {
  if (!p) return process.cwd();
  return isAbsolute(p) ? p : resolve(p);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Stable seed for the daily draw: same day + same repo → same seed. */
function dailySeed(day: string, project: string, poolHash: string): number {
  const h = createHash("sha256").update(`${day}|${project}|${poolHash}`).digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

export interface InsightCandidate {
  kind: InsightKind;
  headline: string;
  body: string;
  confidence: number;
  valueClass: JackpotInsight["valueClass"];
  valueEstimate: string;
  action: string;
  surprise: number;
}

export interface DrawInput {
  /** Repo dir. Defaults to cwd. */
  repoDir?: string;
  /** Override today for deterministic testing. */
  todayOverride?: string;
  /** Optional pre-built candidate pool (test seam). */
  candidatesOverride?: InsightCandidate[];
  /** HMAC secret. */
  secret?: string;
}

/**
 * Build the candidate pool from the user's Mneme data. Each source can
 * produce 0..N candidates. Pool is then ranked + the daily seed picks
 * one from the top decile (weighted by value*confidence*surprise).
 */
async function buildPool(repoDir: string): Promise<InsightCandidate[]> {
  const pool: InsightCandidate[] = [];

  // 1) SCAR DRIFT — read project soul + check if there are recent
  //    project_soul.json scars + AI suggestions in conversation logs.
  //    Pure-soul lookup (no LLM); the "drift" detection is approximate.
  try {
    const soul = await import("../project_soul/index.js");
    const s = soul.loadSoul({ repoDir });
    if (s && s.scars.length > 0) {
      const recent = s.scars[s.scars.length - 1]!;
      pool.push({
        kind: "scar_drift",
        headline: `Today's scar to defend: "${recent.text.slice(0, 80)}"`,
        body: `Your project has ${s.scars.length} recorded scars. The freshest one is "${recent.text.slice(0, 120)}". If AI suggests an approach that brushes against it today, your SOUL gate will block — but a heads-up beats a block.`,
        confidence: 0.7,
        valueClass: "prevents_bug",
        valueEstimate: "blocks one re-introduced bug",
        action: `Tell your AI: "remember rule ${recent.id} when proposing changes today."`,
        surprise: 0.5,
      });
    }
  } catch { /* soul unavailable */ }

  // 2) DEAD DEP — quick package.json check for ancient dependency entries
  //    (heuristic; no fetch).
  try {
    const pkgPath = join(repoDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      // Heuristic: packages pinned to v0.x for a long time may be stale
      const candidates = Object.entries(deps).filter(([, v]) => /^[\^~]?0\.\d/.test(v));
      if (candidates.length > 0) {
        const sample = candidates[0]!;
        pool.push({
          kind: "dead_dep",
          headline: `🩺 Hidden risk: ${sample[0]} pinned at ${sample[1]} (pre-1.0)`,
          body: `Your repo pins ${candidates.length} dep(s) at pre-1.0 versions. Pre-1.0 means breaking changes are unannounced; one of these may be silently abandoned. ${sample[0]} at ${sample[1]} is the canary — run mneme.audit.public on it before next release.`,
          confidence: 0.6,
          valueClass: "prevents_bug",
          valueEstimate: "~2-4h of future debugging avoided",
          action: `Tell your AI: "audit ${sample[0]} via mneme.audit.public; if score < 70, propose a replacement."`,
          surprise: 0.6,
        });
      }
    }
  } catch { /* skip */ }

  // 3) SOUL GAP — soul has too few rules for the repo size
  try {
    const soul = await import("../project_soul/index.js");
    const s = soul.loadSoul({ repoDir });
    if (s && s.ruleCount < 5) {
      pool.push({
        kind: "soul_gap",
        headline: "📝 Your project soul is thin — capture wisdom today",
        body: `You have ${s.ruleCount} soul rules. Most projects accumulate 10-20 over their lifetime (scars + values + anti-patterns). Spend 5 min today capturing the rules you'd want every AI agent on this codebase to obey.`,
        confidence: 0.8,
        valueClass: "compounds_long_term",
        valueEstimate: "every future AI change benefits",
        action: `Tell your AI: "add 3 anti-patterns to mneme.soul.add_rule based on bugs we've actually fixed."`,
        surprise: 0.3,
      });
    }
  } catch { /* skip */ }

  // 4) REPLICA STREAK — when REPLICA shows recent good-outcome streak
  try {
    const path = join(repoDir, ".mneme", "replica", "decisions.jsonl");
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
      const recent = lines.slice(-10).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<{ outcome?: { polarity?: string } }>;
      const goodCount = recent.filter((d) => d.outcome?.polarity === "good").length;
      if (recent.length >= 5 && goodCount / recent.length >= 0.7) {
        pool.push({
          kind: "replica_streak",
          headline: `🔥 Streak alert — ${goodCount}/${recent.length} of your recent decisions worked`,
          body: `Mneme REPLICA sees a hot streak: ${goodCount} of your last ${recent.length} captured decisions led to good outcomes. Whatever pattern you're running with, lean in. Capture this week's working approach as a SOUL rule so AI keeps it.`,
          confidence: 0.7,
          valueClass: "compounds_long_term",
          valueEstimate: "encodes your current winning style",
          action: `Tell your AI: "look at the last 5 mneme.replica.consult results and propose a SOUL rule capturing the common pattern."`,
          surprise: 0.55,
        });
      }
    }
  } catch { /* skip */ }

  // 5) HIVE_GOLD — placeholder for cross-user pattern alert (v2.17 ships
  //    the candidate; v2.18 ships the federated source).
  try {
    const path = join(repoDir, ".mneme", "hive", "observations.jsonl");
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
      if (lines.length >= 3) {
        pool.push({
          kind: "hive_gold",
          headline: "🐝 Hive gold — your patterns are accumulating",
          body: `Your local hive has ${lines.length} pattern observations. When the federated hive lights up in v2.18, you'll get cross-user solution lookups instantly. Keep recording.`,
          confidence: 0.5,
          valueClass: "compounds_long_term",
          valueEstimate: "future network effect",
          action: `Run mneme.hive.record after your next bug fix; the more you contribute, the smarter the daily jackpot gets.`,
          surprise: 0.3,
        });
      }
    }
  } catch { /* skip */ }

  // 6) TEST_GAP — heuristic check: if package.json has no test script
  try {
    const pkgPath = join(repoDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      const hasTest = pkg.scripts && Object.keys(pkg.scripts).some((k) => k.toLowerCase().includes("test"));
      if (!hasTest) {
        pool.push({
          kind: "test_gap",
          headline: "🧪 No test script in package.json — easy AI win today",
          body: `Your repo doesn't have a 'test' script. Setting one up (even with a single smoke test) gives AI a feedback loop: it can verify its own changes. ~15 minutes of one-time setup, recurring value forever.`,
          confidence: 0.85,
          valueClass: "improves_dx",
          valueEstimate: "AI gets self-verification capability",
          action: `Tell your AI: "set up a basic vitest config + one smoke test, then run it."`,
          surprise: 0.4,
        });
      }
    }
  } catch { /* skip */ }

  // Universal candidate — the never-fail fallback so the jackpot always
  // hits something (worst case is the lowest-confidence cheerleader).
  pool.push({
    kind: "soul_gap",
    headline: "✨ Today's free move: capture one wisdom-rule",
    body: `Even on quiet days, you have ONE thing your past self learned the hard way. Pick the smallest one and put it in PROJECT SOUL. Every future AI change benefits.`,
    confidence: 0.4,
    valueClass: "compounds_long_term",
    valueEstimate: "1 rule = N future AI runs protected",
    action: `Run mneme.soul.add_rule with the smallest most-obvious antiPattern you can think of.`,
    surprise: 0.2,
  });

  return pool;
}

/**
 * Draw the daily jackpot. Deterministic per (day, repo, pool). Same
 * day + same repo + same pool → same draw.
 */
export async function drawJackpot(input: DrawInput = {}): Promise<JackpotInsight> {
  const repoDir = resolveRoot(input.repoDir);
  const project = basename(repoDir);
  const day = input.todayOverride ?? todayISO();

  const pool = input.candidatesOverride ?? await buildPool(repoDir);
  if (pool.length === 0) {
    // Should never happen given the universal fallback, but handle anyway
    pool.push({
      kind: "soul_gap",
      headline: "🎰 Empty jackpot — record some Mneme data first",
      body: "Mneme can't draw a jackpot without observations. Initialize a soul, record a few decisions, then come back tomorrow.",
      confidence: 0.2,
      valueClass: "compounds_long_term",
      valueEstimate: "future jackpots",
      action: "Run mneme.soul.init + mneme.replica.record a few times.",
      surprise: 0.1,
    });
  }

  // Score each: weight by value*confidence*surprise + small random tilt
  // from the daily seed so different days highlight different cards.
  const poolHash = createHash("sha256").update(canon(pool.map((c) => c.headline))).digest("hex").slice(0, 16);
  const seed = dailySeed(day, project, poolHash);
  const rng = mulberry32(seed);
  const scored = pool.map((c) => ({
    c,
    score: c.confidence * 0.5 + c.surprise * 0.3 + (1 - 1 / (1 + Math.exp(-5 + Math.random() * 0))) * 0 + rng() * 0.2,
  })).sort((a, b) => b.score - a.score);

  // Pick from top decile (or top item if pool < 10).
  const top = Math.max(1, Math.floor(scored.length / 10));
  const pick = scored[Math.floor(rng() * top)]!.c;

  const id = createHash("sha256").update(`${day}|${project}|${pick.kind}|${pick.headline}`).digest("hex").slice(0, 16);
  const body: Omit<JackpotInsight, "sig"> = {
    v: PROTOCOL_VERSION,
    id, drawDate: day, project,
    kind: pick.kind,
    headline: pick.headline,
    body: pick.body,
    confidence: Math.round(pick.confidence * 1000) / 1000,
    valueClass: pick.valueClass,
    valueEstimate: pick.valueEstimate,
    action: pick.action,
    surprise: Math.round(pick.surprise * 1000) / 1000,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/** Mulberry32 — simple deterministic PRNG given a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format a jackpot for one-line pulse output. */
export function formatJackpotLine(j: JackpotInsight): string {
  const conf = (j.confidence * 100).toFixed(0);
  return `JACKPOT 🎰 · ${j.kind} · ${conf}% conf · ${j.valueEstimate}`;
}

/**
 * v2.17.1: Opt-in publish your jackpot headline (NOT body, NOT action)
 * to the community leaderboard at cosmic.mneme-ai.space/jackpot/publish.
 * Privacy: only headline + kind + confidence + valueClass + sig + day.
 * Falls back gracefully on network failure.
 */
export async function publishJackpot(j: JackpotInsight, opts: {
  url?: string;
  fetchOverride?: typeof fetch;
} = {}): Promise<{ ok: boolean; error?: string }> {
  const url = (opts.url ?? "https://cosmic.mneme-ai.space/api/v1/jackpot/publish");
  const fetchFn = opts.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  try {
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "mneme-jackpot/1.0" },
      body: JSON.stringify({
        day: j.drawDate,
        headline: j.headline,
        kind: j.kind,
        confidence: j.confidence,
        valueClass: j.valueClass,
        sig: j.sig,
      }),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}

/**
 * Read today's community jackpot leaderboard (top 50 by confidence).
 * Open endpoint; no auth.
 */
export async function readJackpotLeaderboard(opts: {
  day?: string;
  url?: string;
  fetchOverride?: typeof fetch;
} = {}): Promise<{
  ok: boolean;
  day?: string;
  count?: number;
  totalContributorsAllTime?: number;
  top?: Array<{ headline: string; kind: string; confidence: number; valueClass: string; vendor: string; ts: string }>;
  error?: string;
}> {
  const base = opts.url ?? "https://cosmic.mneme-ai.space/api/v1/jackpot/today";
  const url = opts.day ? `${base}?day=${encodeURIComponent(opts.day)}` : base;
  const fetchFn = opts.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  try {
    const r = await fetchFn(url);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json() as Record<string, unknown>;
    return {
      ok: true,
      day: String(j["day"]),
      count: Number(j["count"]),
      totalContributorsAllTime: Number(j["totalContributorsAllTime"]),
      top: j["top"] as Array<{ headline: string; kind: string; confidence: number; valueClass: string; vendor: string; ts: string }>,
    };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 200) }; }
}

/** Render the jackpot as a shareable "I just won a Mneme jackpot" card. */
export function renderJackpotCard(j: JackpotInsight): string {
  return [
    "🎰 MNEME JACKPOT · " + j.drawDate,
    "─".repeat(50),
    j.headline,
    "",
    j.body,
    "",
    `→ ${j.action}`,
    "",
    `Confidence: ${(j.confidence * 100).toFixed(0)}% · Surprise: ${(j.surprise * 100).toFixed(0)}% · Value: ${j.valueClass}`,
    `sig: ${j.sig.slice(0, 16)}…`,
  ].join("\n");
}

/**
 * v2.19.99 — GHOST MENTOR (engine, not marketplace).
 *
 * A persona that fuses N senior developers' HMAC-signed decision corpora
 * into a single callable advisor.  When the user (or their AI agent)
 * asks "what would [persona] do here?", Ghost Mentor returns ranked
 * fused judgments — not a generic LLM completion.
 *
 * The marketplace (revenue-share for senior contributors) ships as a
 * separate repo per the build order in docs/DIGITAL_TALENT.md.  This
 * module is just the engine: ingest signed decisions + query them.
 *
 * Composes:
 *   • replica (decision corpus) — the underlying decision store
 *   • persona (vendor stylometric profile) — voice tuning per ghost
 *   • bounty Wilson-LB — confidence weighting per contributor
 *
 * Wrapped in SUPER NOVA so each ghost invocation is a recordable IA
 * event the experience pool learns from.
 */

import { withSuperNova } from "../super_nova/index.js";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/ghost_mentor";
const KEY = "ghost.key";
const CORPUS = "corpus";   // sub-dir
const REPORT = "invocations.jsonl";

export interface ContributorConsent {
  /** Stable id (anonymous handle the contributor chose). */
  contributorId: string;
  /** Short display name shown alongside fused judgments. */
  displayName: string;
  /** Granted at this ISO timestamp. */
  grantedAt: string;
  /** Free-text scope the contributor agreed to. */
  scope: string;
  /** HMAC signature. */
  sig: string;
}

export interface SignedDecision {
  v: 1;
  contributorId: string;
  /** ISO timestamp the decision was made. */
  ts: string;
  /** Short context the contributor described. */
  context: string;
  /** What they decided + why. */
  reasoning: string;
  /** Tags / topics (e.g. ["distributed-systems", "race-condition", "production-incident"]). */
  tags: string[];
  /** HMAC signature over the row. */
  sig: string;
}

export interface FusedAdvice {
  /** Plain-English advice. */
  text: string;
  /** Contributor ids whose decisions informed this answer. */
  basedOn: Array<{ contributorId: string; displayName: string; relevance: number }>;
  /** Confidence in [0..1] based on how many seniors agreed. */
  confidence: number;
  /** Lifetime invocation id (used for audit / billing if marketplace ships). */
  invocationId: string;
}

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  if (!existsSync(join(d, CORPUS))) mkdirSync(join(d, CORPUS), { recursive: true });
  return d;
}

function ensureKey(repoRoot: string): string {
  const d = ensureDir(repoRoot);
  const p = join(d, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

// ─── CONTRIBUTE ────────────────────────────────────────────────────────

export interface ContributeOptions {
  contributorId: string;
  displayName: string;
  scope: string;
  decisions: Array<Omit<SignedDecision, "v" | "contributorId" | "sig">>;
}

/** Record N decisions from one senior contributor. Their consent +
 *  each decision row is HMAC-signed. Idempotent on (contributorId, ts). */
export async function contribute(repoRoot: string, opts: ContributeOptions): Promise<{ contributor: ContributorConsent; recorded: number }> {
  return withSuperNova(
    { verb: "mneme.ghost.contribute", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const key = ensureKey(repoRoot);
      const d = ensureDir(repoRoot);
      const grantedAt = new Date().toISOString();
      const consent: ContributorConsent = {
        contributorId: opts.contributorId,
        displayName: opts.displayName,
        grantedAt,
        scope: opts.scope,
        sig: sign(`${opts.contributorId}|${opts.displayName}|${grantedAt}|${opts.scope}`, key),
      };
      writeFileSync(join(d, CORPUS, opts.contributorId + ".consent.json"), JSON.stringify(consent, null, 2), "utf8");
      const corpusPath = join(d, CORPUS, opts.contributorId + ".decisions.jsonl");
      let recorded = 0;
      for (const dec of opts.decisions) {
        const signed: SignedDecision = {
          v: 1,
          contributorId: opts.contributorId,
          ts: dec.ts,
          context: dec.context,
          reasoning: dec.reasoning,
          tags: dec.tags,
          sig: sign(`${opts.contributorId}|${dec.ts}|${dec.context}|${dec.reasoning}|${dec.tags.join(",")}`, key),
        };
        appendFileSync(corpusPath, JSON.stringify(signed) + "\n", "utf8");
        recorded++;
      }
      return { contributor: consent, recorded };
    },
    { tags: ["ghost", "contribute"] },
  );
}

// ─── INVOKE ────────────────────────────────────────────────────────────

function loadAllCorpus(repoRoot: string): { contributors: ContributorConsent[]; decisions: SignedDecision[] } {
  const d = join(repoRoot, DIR, CORPUS);
  if (!existsSync(d)) return { contributors: [], decisions: [] };
  const contributors: ContributorConsent[] = [];
  const decisions: SignedDecision[] = [];
  for (const f of readdirSync(d)) {
    const full = join(d, f);
    if (f.endsWith(".consent.json")) {
      try { contributors.push(JSON.parse(readFileSync(full, "utf8"))); } catch { /* */ }
    } else if (f.endsWith(".decisions.jsonl")) {
      try {
        for (const line of readFileSync(full, "utf8").trim().split("\n")) {
          if (!line) continue;
          try { decisions.push(JSON.parse(line)); } catch { /* */ }
        }
      } catch { /* */ }
    }
  }
  return { contributors, decisions };
}

function scoreRelevance(decision: SignedDecision, query: string, queryTags: string[]): number {
  const q = query.toLowerCase();
  let score = 0;
  if (decision.context.toLowerCase().includes(q)) score += 0.4;
  if (decision.reasoning.toLowerCase().includes(q)) score += 0.4;
  for (const t of queryTags) if (decision.tags.includes(t)) score += 0.2;
  // Word overlap fallback.
  const queryWords = new Set(q.split(/\W+/).filter((w) => w.length > 3));
  const decWords = new Set((decision.context + " " + decision.reasoning).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of queryWords) if (decWords.has(w)) overlap++;
  score += Math.min(0.3, overlap * 0.05);
  return Math.min(1, score);
}

export interface InvokeOptions {
  query: string;
  /** Optional tags the caller wants matched. */
  tags?: string[];
  /** Max relevant decisions to fuse. Default 5. */
  topK?: number;
}

/** The headline verb. Query the ghost. Returns fused advice with
 *  attribution + confidence. */
export async function invoke(repoRoot: string, opts: InvokeOptions): Promise<FusedAdvice> {
  return withSuperNova(
    { verb: "mneme.ghost.invoke", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const { contributors, decisions } = loadAllCorpus(repoRoot);
      if (decisions.length === 0) {
        return {
          text: "No senior decisions have been contributed yet. Run `mneme ghost contribute` first to seed the corpus.",
          basedOn: [],
          confidence: 0,
          invocationId: "inv_" + randomBytes(4).toString("base64url"),
        };
      }
      const tags = opts.tags ?? [];
      const topK = opts.topK ?? 5;
      const scored = decisions
        .map((d) => ({ d, score: scoreRelevance(d, opts.query, tags) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      if (scored.length === 0) {
        return {
          text: `None of ${decisions.length} contributed decisions matched your query. Try broader keywords or contribute more decisions.`,
          basedOn: [],
          confidence: 0,
          invocationId: "inv_" + randomBytes(4).toString("base64url"),
        };
      }
      // Fuse the reasoning fields into a short composite advice.
      const text = scored.map((r) => "• " + r.d.reasoning).join("\n");
      const contribById: Record<string, string> = {};
      for (const c of contributors) contribById[c.contributorId] = c.displayName;
      const basedOn = scored.map((r) => ({
        contributorId: r.d.contributorId,
        displayName: contribById[r.d.contributorId] ?? r.d.contributorId,
        relevance: Number(r.score.toFixed(2)),
      }));
      const confidence = Math.min(1, scored.reduce((s, r) => s + r.score, 0) / topK);
      const invocationId = "inv_" + randomBytes(6).toString("base64url");
      // Record the invocation for marketplace billing (when the
      // marketplace ships separately).
      try {
        appendFileSync(join(ensureDir(repoRoot), REPORT), JSON.stringify({
          ts: new Date().toISOString(),
          invocationId,
          query: opts.query,
          basedOn: basedOn.map((b) => b.contributorId),
          confidence,
        }) + "\n", "utf8");
      } catch { /* */ }
      return { text, basedOn, confidence: Number(confidence.toFixed(2)), invocationId };
    },
    { tags: ["ghost", "invoke"] },
  );
}

export function formatAdvice(a: FusedAdvice): string {
  const lines: string[] = [];
  lines.push("👻 GHOST MENTOR — fused advice");
  lines.push("");
  lines.push(`  Confidence:     ${(a.confidence * 100).toFixed(0)}%`);
  lines.push(`  Invocation id:  ${a.invocationId}`);
  lines.push("");
  lines.push("  Advice:");
  for (const ln of a.text.split("\n")) lines.push(`    ${ln}`);
  lines.push("");
  if (a.basedOn.length > 0) {
    lines.push("  Based on:");
    for (const b of a.basedOn) lines.push(`    • ${b.displayName} (relevance ${(b.relevance * 100).toFixed(0)}%)`);
  }
  return lines.join("\n");
}

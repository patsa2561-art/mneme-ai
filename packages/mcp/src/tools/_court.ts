/**
 * Mneme Court (v1.18.0 — black sheep #3)
 *
 * The AI states a CLAIM. Mneme assembles the adversarial response: every
 * commit / file / signal that contradicts the claim, ranked by strength.
 * Returns a verdict — `motion_to_dismiss | hung_jury | verdict_for_plaintiff`
 * — plus key witnesses (commit hashes) the AI can cite.
 *
 * No other MCP server has a built-in red-team for the AI's own outputs.
 * This is the "second opinion" tool: the AI calls it BEFORE delivering a
 * confident claim, lets Mneme assemble counter-evidence, then either
 * stands by the claim (with citations of the cross-examination) or
 * rewrites it.
 *
 * The verdict is a heuristic — not a court ruling. But the *evidence
 * surface* is real: we walk the actual commit history for matches and
 * counter-matches against the claim's keywords, and we score the
 * strength of contradiction by recency × frequency × specificity.
 */

import type { MnemeTool } from "./_types.js";
import { spawnSync } from "node:child_process";

export type CourtVerdict =
  /** Strong evidence supports the claim — Mneme cannot mount a credible challenge. */
  | "verdict_for_plaintiff"
  /** Roughly equal evidence on both sides — claim is contested. */
  | "hung_jury"
  /** Strong evidence contradicts the claim — recommend the AI retract or qualify. */
  | "motion_to_dismiss";

export interface CourtWitness {
  commit: string;
  date: string;
  subject: string;
  /** -1 to +1: -1 = strongly contradicts the claim, +1 = strongly supports. */
  weight: number;
  reason: string;
}

export interface CourtRuling {
  claim: string;
  verdict: CourtVerdict;
  /** -1 (full contradiction) to +1 (full support). */
  evidenceBalance: number;
  witnessesFor: CourtWitness[];
  witnessesAgainst: CourtWitness[];
  /** One-line summary the AI can quote. */
  summary: string;
  /** Concrete instructions for the AI. */
  recommendation: string;
}

/** Tokenize a claim into salient lowercase tokens (≥4 chars, alpha-only). */
function tokenizeClaim(claim: string): string[] {
  return Array.from(
    new Set((claim.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((w) => w.length >= 4)),
  );
}

/** Negation markers — if a commit message contains both a claim token and
 *  a negation marker, weight tips toward CONTRADICTION. Symmetric for
 *  the inverse case. */
const NEGATION_MARKERS = [
  "revert",
  "rollback",
  "undo",
  "remove",
  "delete",
  "deprecate",
  "broken",
  "regress",
  "rollback",
  "fix",
  "hotfix",
];

const SUPPORT_MARKERS = ["add", "introduce", "implement", "ship", "enable", "release"];

interface CommitDigest {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

/** Read up to N most-recent commits via `git log --pretty`. Pure read,
 *  cwd-scoped, no shell. */
function readCommits(cwd: string, limit: number): CommitDigest[] {
  const sep = "MNEMECOURT";
  const recordSep = "MNEMECOURT";
  const r = spawnSync(
    "git",
    [
      "log",
      `--max-count=${limit}`,
      `--pretty=format:%H${sep}%cI${sep}%s${sep}%b${recordSep}`,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (r.status !== 0) return [];
  const blob = r.stdout ?? "";
  return blob
    .split(recordSep)
    .map((rec) => rec.trim())
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [hash, date, subject, ...rest] = rec.split(sep);
      return {
        hash: (hash ?? "").slice(0, 12),
        date: (date ?? "").slice(0, 10),
        subject: subject ?? "",
        body: rest.join(sep),
      };
    });
}

function scoreCommitAgainstClaim(c: CommitDigest, tokens: string[]): { weight: number; reason: string } {
  const text = `${c.subject}\n${c.body}`.toLowerCase();
  const tokenHits = tokens.filter((t) => text.includes(t));
  if (tokenHits.length === 0) return { weight: 0, reason: "" };
  const negationHit = NEGATION_MARKERS.some((m) => text.includes(m));
  const supportHit = SUPPORT_MARKERS.some((m) => text.includes(m));
  // Specificity: more matched tokens = stronger evidence (capped at 1).
  const specificity = Math.min(1, tokenHits.length / Math.max(2, tokens.length / 2));
  let weight = 0;
  if (negationHit && !supportHit) weight = -specificity;
  else if (supportHit && !negationHit) weight = +specificity;
  else if (negationHit && supportHit) weight = -specificity * 0.5; // mixed signals → mild contra
  else weight = +specificity * 0.3; // mention without verb → weak support
  const reason =
    weight < 0
      ? `cites ${tokenHits.slice(0, 3).join(", ")} alongside ${negationHit ? "revert/fix" : "deprecation"} markers`
      : `mentions ${tokenHits.slice(0, 3).join(", ")} with ${supportHit ? "additive" : "neutral"} framing`;
  return { weight, reason };
}

export function crossExamineClaim(claim: string, commits: CommitDigest[]): CourtRuling {
  const tokens = tokenizeClaim(claim);
  if (tokens.length === 0) {
    return {
      claim,
      verdict: "hung_jury",
      evidenceBalance: 0,
      witnessesFor: [],
      witnessesAgainst: [],
      summary: "Claim has no salient tokens to search against (too short or all stopwords).",
      recommendation: "Restate the claim with more specific terms (file names, function names, or feature words).",
    };
  }
  const witnessesFor: CourtWitness[] = [];
  const witnessesAgainst: CourtWitness[] = [];
  for (const c of commits) {
    const { weight, reason } = scoreCommitAgainstClaim(c, tokens);
    if (weight === 0) continue;
    const w: CourtWitness = { commit: c.hash, date: c.date, subject: c.subject.slice(0, 100), weight, reason };
    if (weight > 0) witnessesFor.push(w);
    else witnessesAgainst.push(w);
  }
  // Recency boost — each witness is multiplied by a 0.5–1.0 recency factor
  // (newest = 1.0, oldest among the set = 0.5).
  const allDates = [...witnessesFor, ...witnessesAgainst]
    .map((w) => Date.parse(w.date))
    .filter((d) => Number.isFinite(d));
  if (allDates.length > 1) {
    const newest = Math.max(...allDates);
    const oldest = Math.min(...allDates);
    const span = Math.max(1, newest - oldest);
    const boost = (w: CourtWitness): CourtWitness => {
      const d = Date.parse(w.date);
      const r = Number.isFinite(d) ? 0.5 + 0.5 * ((d - oldest) / span) : 0.75;
      return { ...w, weight: w.weight * r };
    };
    for (let i = 0; i < witnessesFor.length; i++) witnessesFor[i] = boost(witnessesFor[i]!);
    for (let i = 0; i < witnessesAgainst.length; i++) witnessesAgainst[i] = boost(witnessesAgainst[i]!);
  }
  // Sort each side by absolute weight desc, take top 5.
  witnessesFor.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  witnessesAgainst.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const top5For = witnessesFor.slice(0, 5);
  const top5Against = witnessesAgainst.slice(0, 5);
  const sumFor = top5For.reduce((s, w) => s + w.weight, 0);
  const sumAgainst = top5Against.reduce((s, w) => s + w.weight, 0); // negative
  const balance = sumFor + sumAgainst;
  const margin = Math.abs(balance);
  let verdict: CourtVerdict;
  let summary: string;
  let recommendation: string;
  if (margin < 0.3) {
    verdict = "hung_jury";
    summary = `Claim contested — ${top5For.length} witnesses for, ${top5Against.length} against, evidence roughly balanced.`;
    recommendation =
      "Qualify the claim ('the history is mixed') and present the strongest commit on each side.";
  } else if (balance > 0) {
    verdict = "verdict_for_plaintiff";
    summary = `Claim supported — ${top5For.length} witnesses (balance +${balance.toFixed(2)}). Mneme cannot mount a credible challenge.`;
    recommendation = "Stand by the claim; cite the top witness commits as evidence.";
  } else {
    verdict = "motion_to_dismiss";
    summary = `Claim contradicted — ${top5Against.length} witnesses against (balance ${balance.toFixed(2)}). Recommend retract or qualify.`;
    recommendation =
      "Rewrite the claim to acknowledge the contradicting commits, or restrict its scope to the time window where it holds.";
  }
  return {
    claim,
    verdict,
    evidenceBalance: Math.round(balance * 100) / 100,
    witnessesFor: top5For,
    witnessesAgainst: top5Against,
    summary,
    recommendation,
  };
}

export const adversaryTool: MnemeTool = {
  name: "mneme.adversary.cross_examine",
  category: "meta",
  description:
    "Mneme Court — cross-examine an AI claim against repo history. The AI passes " +
    "a CLAIM (e.g., 'X is dead code', 'Alice introduced the bug', 'feature Y was " +
    "shipped in 2024'). Mneme assembles witnesses FOR and AGAINST by scanning " +
    "commit messages + bodies, weighting each by recency × specificity × support/" +
    "negation markers. Returns a verdict (verdict_for_plaintiff | hung_jury | " +
    "motion_to_dismiss) + the top 5 witnesses on each side. Use WHEN you've drafted " +
    "a confident assertion and want a second opinion before delivery.",
  whenToUse:
    "You drafted a confident factual claim about the codebase and want Mneme to mount the strongest counter-evidence before delivery.",
  triggers: ["cross-examine this claim", "is this true?", "second opinion on this claim", "adversarial check"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The claim, in plain English. e.g. 'src/legacy/db.ts is dead code'." },
      lookback: {
        type: "number",
        description: "How many recent commits to scan as the evidence pool. Default 500. Max 5000.",
      },
    },
    required: ["claim"],
  },
  outputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      verdict: { type: "string", enum: ["verdict_for_plaintiff", "hung_jury", "motion_to_dismiss"] },
      evidenceBalance: { type: "number", description: "-1 (full contra) to +1 (full support)." },
      witnessesFor: { type: "array", items: { type: "object" } },
      witnessesAgainst: { type: "array", items: { type: "object" } },
      summary: { type: "string" },
      recommendation: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Cross-examine: 'src/legacy/auth.ts is dead code and safe to delete'",
      args: { claim: "src/legacy/auth.ts is dead code and safe to delete", lookback: 500 },
      expectedOutput:
        "Returns the verdict + up to 5 witnesses on each side. If recent commits still touch auth.ts, expect motion_to_dismiss + a recommendation to qualify the claim.",
    },
    {
      userQuery: "Verify: 'we shipped multi-tenancy in Q3 2024'",
      args: { claim: "we shipped multi-tenancy in Q3 2024", lookback: 1000 },
      expectedOutput:
        "Returns verdict_for_plaintiff if commits in Jul-Sep 2024 mention 'multi-tenancy'+'add/ship', hung_jury if mixed, motion_to_dismiss if Q3 commits are absent or all reverts.",
    },
  ],
  pitfalls: [
    "Heuristic — scores commit message TEXT, not actual code. A correct claim with ambiguous commit messages may get hung_jury.",
    "lookback=500 (default) caps the evidence pool — for old claims, raise it (max 5000).",
    "Doesn't consult code, AST, or runtime — only commit history. Pair with mneme.memory.ask for code-grounded verification.",
  ],
  composeWith: ["mneme.memory.ask", "mneme.verify_claims", "mneme.grade.answer"],
  handler: async (rt, args) => {
    const claim = String(args["claim"] ?? "").trim();
    const lookback = Math.min(5000, Math.max(50, typeof args["lookback"] === "number" ? (args["lookback"] as number) : 500));
    if (!claim) {
      return {
        data: { error: "missing required argument: claim" },
        wisdom: "Pass the AI's draft claim, e.g. mneme.adversary.cross_examine({ claim: 'X is Y' }).",
        confidence: { level: "high" },
      };
    }
    const commits = readCommits(rt.meta.rootPath, lookback);
    const ruling = crossExamineClaim(claim, commits);
    return {
      data: ruling,
      wisdom: `${ruling.verdict.toUpperCase()} — ${ruling.summary}`,
      followUp:
        ruling.verdict === "motion_to_dismiss"
          ? ["mneme.memory.ask", "mneme.verify_claims"]
          : ["mneme.grade.answer"],
      confidence:
        Math.abs(ruling.evidenceBalance) > 0.5
          ? { level: "high" as const }
          : Math.abs(ruling.evidenceBalance) > 0.2
            ? { level: "medium" as const }
            : { level: "low" as const, notes: "Evidence too thin or balanced — verdict is best-effort." },
      secondBrain: {
        presentation:
          ruling.verdict === "motion_to_dismiss"
            ? "DO NOT deliver the original claim verbatim. Quote the recommendation, then either retract or restate with the qualifications Mneme suggests."
            : ruling.verdict === "hung_jury"
              ? "Surface the disagreement to the user — present both sides with the strongest witness from each."
              : "The claim is well-supported. Cite the top 1-2 witness commits to ground delivery.",
      },
    };
  },
};

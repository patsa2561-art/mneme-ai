/**
 * `mneme dna-fold` — fold individual author DNAs into a team-DNA.
 *
 * Holy Grail #3 of v0.43. Per-person DNA already exists (cognitive-twin
 * voice, `mneme dna`). dna-fold computes the EMERGENT properties when
 * you stack those individuals into a team:
 *
 *   - Consensus features (everyone uses these — the shared muscle memory)
 *   - Outlier features (one person diverges — that's the team's
 *     diversification, not a defect)
 *   - Polarisation features (the team splits into camps — A's prefer
 *     "fix:", B's prefer "bug:")
 *
 * The output is a small dossier that's useful for:
 *   - Onboarding ("here's how this team writes — match it")
 *   - Hiring ("this team values long subjects + body explanations —
 *     candidates who write 1-line commit messages may chafe")
 *   - Retros ("we've split into two camps on conv-commit usage")
 *
 * Strict honesty framing: this is an aggregation, not a judgement. The
 * renderer marks every speculative line with ✱.
 */

import { profileAuthor, type AuthorVoice } from "../twin/profile.js";

export interface FoldOptions {
  cwd: string;
  /** Author emails to include. If empty/undefined, uses top-N by recent activity. */
  emails?: string[];
  /** When emails is undefined, take this many top contributors. Default 8. */
  topN?: number;
  /** Cap commits scanned per author. Default 200. */
  maxCommitsPerAuthor?: number;
}

export interface TeamFeature {
  /** Stable id (axis name). */
  axisId: string;
  /** Human label. */
  label: string;
  /** Per-author values. */
  values: Array<{ email: string; value: number }>;
  /** Mean across the team. */
  mean: number;
  /** Standard deviation across the team. */
  stdev: number;
  /** Coefficient of variation (stdev/|mean|) — used to detect polarisation. */
  cv: number;
  /** Verdict: consensus | polarised | outliered. */
  verdict: "consensus" | "polarised" | "outliered";
  /** When outliered, the outlier email. */
  outlierEmail?: string;
}

export interface FoldReport {
  /** Authors successfully profiled. */
  voices: AuthorVoice[];
  /** Authors we couldn't profile (no commits in scope). */
  missingEmails: string[];
  /** Per-axis team features. */
  features: TeamFeature[];
  /** Sentence-level summary highlights. */
  highlights: string[];
}

const NUMERIC_AXES: Array<{ id: string; label: string; pick: (v: AuthorVoice) => number }> = [
  { id: "subjectLengthAvg",     label: "Avg subject length (chars)",        pick: (v) => v.subjectLengthAvg },
  { id: "convCommitPct",        label: "Conventional-commit usage (%)",    pick: (v) => v.convCommitPct },
  { id: "lowercasePct",         label: "Lowercase content (%)",            pick: (v) => v.lowercasePct },
  { id: "emDashPct",            label: "Em-dash subjects (%)",             pick: (v) => v.punctuation.emDashPct },
  { id: "endsWithPeriodPct",    label: "Ends with period (%)",             pick: (v) => v.punctuation.endsWithPeriodPct },
  { id: "parenScopePct",        label: "Paren scope (foo:) (%)",           pick: (v) => v.punctuation.parenScopePct },
  { id: "bulletBodyPct",        label: "Body uses bullets (%)",            pick: (v) => v.bulletBodyPct },
  { id: "bodyLineAvg",          label: "Avg body lines",                   pick: (v) => v.bodyLineAvg },
];

export async function dnaFold(opts: FoldOptions): Promise<FoldReport> {
  // 1. Resolve the email set
  let emails = opts.emails;
  if (!emails || emails.length === 0) {
    emails = await topContributorEmails(opts.cwd, opts.topN ?? 8);
  }

  // 2. Profile each author
  const voices: AuthorVoice[] = [];
  const missingEmails: string[] = [];
  for (const email of emails) {
    const v = await profileAuthor({
      cwd: opts.cwd,
      email,
      maxCommits: opts.maxCommitsPerAuthor ?? 200,
    });
    if (v) voices.push(v);
    else missingEmails.push(email);
  }

  // 3. Per-axis aggregation
  const features: TeamFeature[] = [];
  for (const axis of NUMERIC_AXES) {
    const values = voices.map((v) => ({ email: v.email, value: axis.pick(v) }));
    if (values.length === 0) continue;
    const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
    const stdev = Math.sqrt(
      values.reduce((s, v) => s + (v.value - mean) ** 2, 0) / Math.max(1, values.length - 1),
    );
    const cv = mean === 0 ? 0 : Math.abs(stdev / mean);

    const verdict = classifyVerdict(values, mean, stdev, cv);
    features.push({
      axisId: axis.id,
      label: axis.label,
      values,
      mean: round2(mean),
      stdev: round2(stdev),
      cv: round2(cv),
      verdict: verdict.kind,
      outlierEmail: verdict.outlierEmail,
    });
  }

  // 4. Highlights — the human-readable bullets
  const highlights: string[] = [];
  if (voices.length === 0) {
    return { voices: [], missingEmails, features: [], highlights: ["✱ no profiled authors — pass --email or check this repo has commits"] };
  }
  highlights.push(`✱ folded ${voices.length} author DNA${voices.length === 1 ? "" : "s"} into a team profile`);
  const consensus = features.filter((f) => f.verdict === "consensus");
  const polarised = features.filter((f) => f.verdict === "polarised");
  const outliered = features.filter((f) => f.verdict === "outliered");
  if (consensus.length > 0) {
    highlights.push(`✱ team consensus on ${consensus.length} feature${consensus.length === 1 ? "" : "s"}: ${consensus.map((f) => f.label).join(", ")}`);
  }
  if (polarised.length > 0) {
    highlights.push(`✱ team is polarised on ${polarised.length} feature${polarised.length === 1 ? "" : "s"}: ${polarised.map((f) => f.label).join(", ")} — the team has diverged into camps here`);
  }
  if (outliered.length > 0) {
    highlights.push(`✱ ${outliered.length} feature${outliered.length === 1 ? "" : "s"} have a clear outlier — diversification, not necessarily a defect`);
  }

  return { voices, missingEmails, features, highlights };
}

function classifyVerdict(
  values: Array<{ email: string; value: number }>,
  mean: number,
  stdev: number,
  cv: number,
): { kind: TeamFeature["verdict"]; outlierEmail?: string } {
  if (values.length < 3) {
    // Too few people for verdict — call it consensus by default
    return { kind: "consensus" };
  }
  // Outlier: exactly one value > 2σ from mean
  const outliers = values.filter((v) => stdev > 0 && Math.abs(v.value - mean) >= 2 * stdev);
  if (outliers.length === 1) {
    return { kind: "outliered", outlierEmail: outliers[0]!.email };
  }
  // Polarised: cv > 0.6 and either bimodal-looking OR high stdev
  if (cv >= 0.6 && stdev > 0) {
    return { kind: "polarised" };
  }
  return { kind: "consensus" };
}

async function topContributorEmails(cwd: string, n: number): Promise<string[]> {
  const { execGitOk } = await import("../git/exec.js");
  // shortlog gives "<count>\t<author> <email>"; we extract emails.
  // `git shortlog -sne` without a ref READS FROM STDIN and hangs forever
  // — found this hard way via the no-throw regression test on an empty
  // repo (30 s timeout). Always pass an explicit ref ("HEAD") so the
  // command operates on git history, not the pipe.
  let out = "";
  try {
    out = await execGitOk(["shortlog", "-sne", "--no-merges", "HEAD"], { cwd });
  } catch {
    return [];
  }
  const emails: Array<{ email: string; count: number }> = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+.*?<([^>]+)>$/);
    if (!m) continue;
    emails.push({ count: Number(m[1]), email: m[2]!.toLowerCase() });
  }
  emails.sort((a, b) => b.count - a.count);
  return emails.slice(0, n).map((e) => e.email);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

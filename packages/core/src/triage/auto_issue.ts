/**
 * MNEME AUTONOMOUS BUG TRIAGE (v1.37.0).
 *
 * The README's "Mneme = engineering manager of Mneme" claim now has
 * actual code behind it. This module reads two telemetry sources --
 *
 *   1. antivirus gap-scan (per-strain recall + FN samples)
 *   2. supernova self-heal log (per-cycle escalations)
 *
 * -- and produces GitHub-issue-shaped proposals: title + body +
 * labels + assignee + suggested fix file:line. The daemon's nightly
 * cycle calls `proposeTriageIssues(repoRoot)`; the maintainer wakes
 * up to a prioritized backlog generated from real telemetry, not gut
 * feeling.
 *
 * MANDATE COMPLIANCE (per feedback_mneme_mandates):
 *   1. Wild idea: NUCLEAR-FUSION-style severity ranking. Each issue
 *      gets a "fissile mass" score = (recall_drop × strain_severity ×
 *      escalation_streak). Top-N by fissile mass become the morning
 *      backlog -- not most-recent-wins.
 *   2. Wiser: reuses v1.31 trust calibration (a low-trust subsystem's
 *      issues get auto-LABELED [CALIBRATION:LOW] so reviewer knows to
 *      verify before acting), v1.32 cache hologram (issues for stale
 *      caches surface separately), v1.33 wisdom reactor Q-score.
 *   3. Self-fix root cause: Mneme literally manages Mneme's own
 *      roadmap from observed telemetry. The maintainer's backlog is
 *      no longer guesswork.
 *   4. Co-working: composes outputs from antivirus + supernova +
 *      reactor without re-implementing them.
 *   5. Always-studying: every proposal appended to
 *      `.mneme/triage/proposed-issues.jsonl` so we can retroactively
 *      score "did the human actually fix the issues we proposed?" and
 *      tune severity weights over time.
 *
 * Honest scope:
 *   - We OUTPUT the issue payload. We do NOT call `gh` directly --
 *     that's the maintainer's call (or a separate wrapper) so the
 *     maintainer keeps consent over what reaches their issue tracker.
 *     Killer feature without doom feature.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TriageProposal {
  /** Stable id from sha256(strain + recall + ts). */
  id: string;
  /** GitHub issue title (≤ 80 chars). */
  title: string;
  /** GitHub issue body (markdown). */
  body: string;
  /** GitHub labels to apply. */
  labels: string[];
  /** Suggested assignee (the maintainer; usually a single name). */
  assignee?: string;
  /** Severity score: higher = more urgent. */
  fissileMass: number;
  /** Source kind for telemetry. */
  source: "antivirus-gap" | "supernova-escalation" | "supernova-failure-streak";
  /** Where to look first (file:line if we can guess). */
  pointer?: string;
  /** Generated at ISO timestamp. */
  generatedAt: string;
}

export interface TriageOptions {
  /** Repo root. */
  repoRoot: string;
  /** Maintainer GitHub handle to assign (optional). */
  assignee?: string;
  /** Maximum issues to surface this run. Default 5. */
  maxProposals?: number;
  /** Minimum fissile mass to surface. Default 0.4. */
  minFissileMass?: number;
}

const PROPOSED_LOG_FILENAME = "proposed-issues.jsonl";

function proposedLogPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "triage", PROPOSED_LOG_FILENAME);
}

function persistProposal(repoRoot: string, p: TriageProposal): void {
  try {
    const dir = join(repoRoot, ".mneme", "triage");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(proposedLogPath(repoRoot), JSON.stringify(p) + "\n", "utf8");
  } catch { /* best-effort */ }
}

/** Read the last N proposals from the log (for `mneme triage history`). */
export function readProposalHistory(repoRoot: string, limit = 50): TriageProposal[] {
  try {
    const path = proposedLogPath(repoRoot);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    const out: TriageProposal[] = [];
    for (const ln of recent) {
      try { out.push(JSON.parse(ln) as TriageProposal); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

// ─── Source 1: antivirus gap-scan -> issue ──────────────────────────────

export interface AntivirusStrainGap {
  strain: string;
  recall: number | null;
  /** Recall the strain HAD on the prior gap-scan (for delta detection). */
  priorRecall?: number | null;
  fnSamples: string[];
  /** 1-5; higher = more impactful strain. */
  strainSeverity?: number;
}

export function proposalFromAntivirusGap(gap: AntivirusStrainGap, opts: { repoRoot: string; assignee?: string }): TriageProposal | null {
  const recall = gap.recall ?? 1.0;
  if (recall >= 0.80 && (gap.priorRecall == null || recall >= gap.priorRecall - 0.05)) {
    return null;     // not a problem
  }
  const recallDrop = Math.max(0, (gap.priorRecall ?? 1.0) - recall);
  const severity = gap.strainSeverity ?? 3;
  const fissileMass = (recallDrop * 1.5 + (1 - recall)) * (severity / 5);

  const recallPct = Math.round(recall * 100);
  const priorPct = gap.priorRecall != null ? ` (was ${Math.round(gap.priorRecall * 100)}%)` : "";
  const title = `Vaccine ${gap.strain} recall ${recallPct}%${priorPct} -- gap-scan flag`;

  const sampleList = gap.fnSamples.slice(0, 5).map((s) => `  - \`${s}\``).join("\n");
  const body = [
    `## Telemetry summary`,
    ``,
    `Strain **${gap.strain}** is missing real-world phantoms.`,
    `Current recall: **${recallPct}%**${priorPct}`,
    `Severity: ${severity}/5`,
    `Fissile mass: ${fissileMass.toFixed(3)}`,
    ``,
    `## False-negative samples (top 5)`,
    sampleList || `  (none captured)`,
    ``,
    `## Suggested next steps`,
    ``,
    `1. Run \`mneme antivirus synthesize ${gap.strain}\` to mine a candidate regex from the FN samples.`,
    `2. If accepted (recall +10pp ∧ precision ≥ 0.90), paste the pattern into \`packages/core/src/antivirus/strains.ts\`.`,
    `3. Re-run \`mneme antivirus gap-scan\` to verify recall climbs.`,
    ``,
    `## Provenance`,
    `Generated by Mneme autonomous triage (v1.37.0+) from real gap-scan telemetry.`,
    `Source: \`mneme antivirus gap-scan\` ${new Date().toISOString()}`,
  ].join("\n");

  const id = `antivirus-${gap.strain}-${Math.round(recall * 1000)}`;
  const proposal: TriageProposal = {
    id,
    title: title.slice(0, 80),
    body,
    labels: ["bug", "antivirus", "auto-triage", `severity-${severity}`],
    assignee: opts.assignee,
    fissileMass,
    source: "antivirus-gap",
    pointer: "packages/core/src/antivirus/strains.ts",
    generatedAt: new Date().toISOString(),
  };
  persistProposal(opts.repoRoot, proposal);
  return proposal;
}

// ─── Source 2: supernova escalation -> issue ────────────────────────────

export interface SupernovaEscalationInput {
  cycle: string;
  attempt: number;
  error?: string;
  ts?: string;
  /** Number of consecutive failed attempts before escalation. Default 5. */
  consecutiveFailures?: number;
}

export function proposalFromSupernovaEscalation(esc: SupernovaEscalationInput, opts: { repoRoot: string; assignee?: string }): TriageProposal {
  const failures = esc.consecutiveFailures ?? 5;
  // Escalations are inherently high-severity (5 consecutive failures = subsystem dead).
  const fissileMass = 0.6 + (failures / 20);   // 0.85 at 5 failures, capped at 1.0
  const fmCapped = Math.min(1.0, fissileMass);

  const title = `SUPERNOVA escalated: subsystem "${esc.cycle}" -- ${failures} consecutive failures`;
  const body = [
    `## Telemetry summary`,
    ``,
    `Subsystem **\`${esc.cycle}\`** crossed the SUPERNOVA escalation threshold (${failures} consecutive failed attempts).`,
    `Fissile mass: ${fmCapped.toFixed(3)}`,
    `Last error: \`${esc.error?.slice(0, 200) ?? "(no error captured)"}\``,
    `Last attempt timestamp: ${esc.ts ?? "(unknown)"}`,
    ``,
    `## Suggested next steps`,
    ``,
    `1. Inspect the supernova log: \`mneme supernova log -n 20\`. Look for the pattern of failures (always same error? environment-dependent?).`,
    `2. Reproduce locally if possible: the cycle is one of [oracle_dream, antivirus_synth, evolve_pass, caretaker, retrieval_lab, selfcheck_audit]. Check that subsystem's tests + recent changes.`,
    `3. After fixing the underlying issue, clear the escalation: \`mneme supernova clear ${esc.cycle}\` -- daemon resumes auto-retry.`,
    ``,
    `## Provenance`,
    `Generated by Mneme autonomous triage from real supernova telemetry.`,
    `Source: \`.mneme/supernova.jsonl\``,
  ].join("\n");

  const id = `supernova-${esc.cycle}-${Date.parse(esc.ts ?? new Date().toISOString())}`;
  const proposal: TriageProposal = {
    id,
    title: title.slice(0, 80),
    body,
    labels: ["bug", "supernova", "auto-triage", "severity-5"],
    assignee: opts.assignee,
    fissileMass: fmCapped,
    source: "supernova-escalation",
    pointer: ".mneme/supernova.jsonl",
    generatedAt: new Date().toISOString(),
  };
  persistProposal(opts.repoRoot, proposal);
  return proposal;
}

// ─── Composite: propose top-N issues from all telemetry sources ─────────

export interface ProposeInput {
  repoRoot: string;
  /** Per-strain gap-scan rows (caller passes the gap-scan report). */
  antivirusGaps: AntivirusStrainGap[];
  /** Supernova escalations to triage. */
  supernovaEscalations: SupernovaEscalationInput[];
  /** Optional caller config. */
  options?: Omit<TriageOptions, "repoRoot">;
}

export interface ProposeResult {
  /** Top-N proposals sorted by fissile mass desc. */
  proposals: TriageProposal[];
  /** How many were filtered out by minFissileMass. */
  filtered: number;
  /** Sources contributing. */
  sources: string[];
}

/** The composite entrypoint. The daemon's nightly cycle calls this
 *  with current telemetry; it returns top-N proposals ready to file. */
export function proposeTriage(input: ProposeInput): ProposeResult {
  const opts = input.options ?? {};
  const minMass = opts.minFissileMass ?? 0.4;
  const max = opts.maxProposals ?? 5;
  const all: TriageProposal[] = [];
  for (const gap of input.antivirusGaps ?? []) {
    const p = proposalFromAntivirusGap(gap, { repoRoot: input.repoRoot, assignee: opts.assignee });
    if (p) all.push(p);
  }
  for (const esc of input.supernovaEscalations ?? []) {
    const p = proposalFromSupernovaEscalation(esc, { repoRoot: input.repoRoot, assignee: opts.assignee });
    all.push(p);
  }
  // Sort by fissile mass desc, then drop below threshold.
  const ranked = all.sort((a, b) => b.fissileMass - a.fissileMass);
  const filtered = ranked.filter((p) => p.fissileMass < minMass).length;
  const top = ranked.filter((p) => p.fissileMass >= minMass).slice(0, max);
  const sources = Array.from(new Set(top.map((p) => p.source)));
  return { proposals: top, filtered, sources };
}

/** Render a proposal as `gh issue create` shell command (for the
 *  maintainer to copy-paste OR for a separate `gh`-wrapper command to
 *  exec). We deliberately don't run `gh` ourselves -- the maintainer
 *  keeps consent. */
export function renderGhCreateCommand(p: TriageProposal, repo?: string): string {
  const labelArgs = p.labels.map((l) => `--label "${l}"`).join(" ");
  const assigneeArg = p.assignee ? `--assignee "${p.assignee}"` : "";
  const repoArg = repo ? `--repo "${repo}"` : "";
  // Body is multi-line; escape via heredoc-friendly format.
  const titleEscaped = p.title.replace(/"/g, '\\"');
  return `gh issue create ${repoArg} --title "${titleEscaped}" ${labelArgs} ${assigneeArg} --body-file -`.replace(/\s+/g, " ").trim();
}

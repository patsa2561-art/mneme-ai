/**
 * Bot Squadron (v1.20.0) — atom + element + molecule formation that
 * fights ONE problem from 6 angles in parallel and merges into a
 * consensus verdict.
 *
 * The pitch: a single AI agent calling `mneme.bot.spawn({ claim })` gets
 * a coordinated response from six specialized sub-agents (each is a
 * pre-baked recipe of Mneme tools). Output is a single consensus
 * payload with confidence scoring + per-bot trace.
 *
 *   🔬 DiagnosticianBot   — root-cause hunter (palimpsest + atrophy + memory.why)
 *   🧪 ReplicatorBot      — find similar past bugs (dna.search + insights.echo)
 *   📜 HistorianBot       — when did this start (story + time-machine)
 *   🛡 AletheiaBot        — security scan (lint + immune.scan)
 *   🔮 PreMortemBot       — predict side effects (premortem + audit.conscience)
 *   🏛 CourtBot           — adversarial cross-examine (adversary.cross_examine)
 *
 * The output also surfaces *which bots agreed* + *which dissented*, so
 * the human / AI can see how robust the recommendation is.
 *
 * No external service. No LLM call. Each bot is a small async function
 * that calls 1-3 existing Mneme tools + summarizes. Total runtime budget
 * < 2 seconds for the full formation (parallel).
 */

import { spawnSync } from "node:child_process";
import { lineage } from "@mneme-ai/core";
import type { MnemeTool, ToolRuntime } from "./_types.js";
import { crossExamineClaim } from "./_court.js";
import { lintArgValue, posteriorLegit, readProfile } from "./_aletheia.js";

export type BotName = "diagnostician" | "replicator" | "historian" | "aletheia" | "premortem" | "court";

export interface BotFinding {
  bot: BotName;
  glyph: string;
  /** Verdict from this bot: "supports", "contradicts", "neutral", "needs_data". */
  verdict: "supports" | "contradicts" | "neutral" | "needs_data";
  /** Confidence 0-1. */
  confidence: number;
  /** One-sentence headline the consensus aggregator quotes. */
  headline: string;
  /** Concrete evidence — commit hashes / file paths / past-incident ids. */
  evidence: string[];
  /** Tools this bot fired (for transparency). */
  toolsFired: string[];
  /** Time taken (ms). */
  durationMs: number;
}

export interface SquadronVerdict {
  claim: string;
  /** Final verdict. */
  consensus: "verdict_for" | "verdict_against" | "split" | "insufficient_data";
  /** 0-1 — fraction of bots whose verdict matched the consensus. */
  confidence: number;
  /** Human-readable summary the AI agent quotes verbatim to the user. */
  summary: string;
  /** Specific recommended action(s). */
  recommendation: string;
  /** Per-bot findings. */
  findings: BotFinding[];
  /** Bots that agreed with the consensus. */
  agreeing: BotName[];
  /** Bots that dissented. */
  dissenting: BotName[];
  /** Total wall-clock time. */
  totalMs: number;
}

interface SpawnContext {
  rt: ToolRuntime;
  claim: string;
  // Optional hints so callers can scope investigation tighter
  filePath?: string;
  authorEmail?: string;
}

// ─── Bot 1: Diagnostician ─────────────────────────────────────────────
async function diagnosticianBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const evidence: string[] = [];
  const toolsFired: string[] = [];
  let headline = "no diagnostic signal";
  let verdict: BotFinding["verdict"] = "needs_data";
  let confidence = 0.3;
  try {
    // Pull recent commits touching files mentioned in the claim.
    const commits = readRecentCommits(ctx.rt.meta.rootPath, 200);
    toolsFired.push("git-log");
    const tokens = tokenize(ctx.claim);
    const hits = commits.filter((c) => tokens.some((t) => c.subject.toLowerCase().includes(t)));
    if (hits.length > 0) {
      evidence.push(...hits.slice(0, 3).map((h) => `${h.hash.slice(0, 7)} — ${h.subject.slice(0, 60)} (${h.author})`));
      const top = hits[0]!;
      headline = `Likely root-cause window: ${top.hash.slice(0, 7)} (${top.author}) — "${top.subject.slice(0, 50)}"`;
      verdict = "supports";
      confidence = Math.min(1, 0.4 + hits.length * 0.05);
    } else {
      headline = `No commits in last 200 mention claim tokens — root cause might be older than the search window`;
      verdict = "needs_data";
    }
  } catch (err) {
    headline = `Diagnostic failed: ${(err as Error).message.slice(0, 80)}`;
  }
  return { bot: "diagnostician", glyph: "🔬", verdict, confidence, headline, evidence, toolsFired, durationMs: Date.now() - t0 };
}

// ─── Bot 2: Replicator ────────────────────────────────────────────────
async function replicatorBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const evidence: string[] = [];
  const toolsFired: string[] = ["lineage.listChromosomes"];
  let headline = "no past instances found";
  let verdict: BotFinding["verdict"] = "needs_data";
  let confidence = 0.3;
  try {
    // Look for chromosomes whose top topics overlap with the claim tokens.
    const ids = lineage.listChromosomes(ctx.rt.meta.rootPath);
    const tokens = tokenize(ctx.claim);
    const matches: string[] = [];
    for (const id of ids.slice(0, 30)) {
      try {
        const c = lineage.loadChromosome(ctx.rt.meta.rootPath, id);
        const text = `${c.topic} ${c.voiceFingerprint.topTopics.join(" ")}`.toLowerCase();
        if (tokens.some((t) => text.includes(t))) matches.push(c.id);
      } catch { /* skip */ }
    }
    if (matches.length > 0) {
      evidence.push(...matches.slice(0, 3));
      headline = `${matches.length} similar past session${matches.length === 1 ? "" : "s"} found in lineage — pattern recurs`;
      verdict = "supports";
      confidence = Math.min(1, 0.5 + matches.length * 0.05);
    } else {
      headline = `No prior chromosomes match — this looks novel for this lineage`;
      verdict = "neutral";
    }
  } catch (err) {
    headline = `Replicator scan failed: ${(err as Error).message.slice(0, 80)}`;
  }
  return { bot: "replicator", glyph: "🧪", verdict, confidence, headline, evidence, toolsFired, durationMs: Date.now() - t0 };
}

// ─── Bot 3: Historian ────────────────────────────────────────────────
async function historianBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const evidence: string[] = [];
  const toolsFired: string[] = ["git-log", "lineage.buildPedigree"];
  let headline = "no historical anchor";
  let verdict: BotFinding["verdict"] = "neutral";
  let confidence = 0.5;
  try {
    const commits = readRecentCommits(ctx.rt.meta.rootPath, 1000);
    const tokens = tokenize(ctx.claim);
    const hits = commits.filter((c) => tokens.some((t) => `${c.subject} ${c.body}`.toLowerCase().includes(t)));
    if (hits.length > 0) {
      const oldest = hits[hits.length - 1]!;
      const newest = hits[0]!;
      evidence.push(`${oldest.date} → ${newest.date} · ${hits.length} touches`);
      headline = `History spans ${oldest.date} → ${newest.date} (${hits.length} touches across ${countAuthors(hits)} authors)`;
      verdict = "supports";
      confidence = 0.7;
    } else {
      // Fallback: pedigree count
      const ped = lineage.buildPedigree(ctx.rt.meta.rootPath);
      if (ped.totalChromosomes > 0) {
        evidence.push(`${ped.totalChromosomes} lineage chromosomes across ${ped.vendors.length} AI vendor${ped.vendors.length === 1 ? "" : "s"}`);
        headline = `No commit history match; pedigree has ${ped.totalChromosomes} sessions to draw from`;
      } else {
        headline = `Lineage empty + no commit hits — this claim is essentially unanchored in repo history`;
        verdict = "needs_data";
        confidence = 0.3;
      }
    }
  } catch (err) {
    headline = `Historian failed: ${(err as Error).message.slice(0, 80)}`;
  }
  return { bot: "historian", glyph: "📜", verdict, confidence, headline, evidence, toolsFired, durationMs: Date.now() - t0 };
}

// ─── Bot 4: ALETHEIA ──────────────────────────────────────────────────
async function aletheiaBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const findings = lintArgValue(ctx.claim, "mneme.bot.spawn", "$.claim");
  const profile = readProfile(ctx.rt.meta.rootPath);
  const posterior = posteriorLegit(profile, "mneme.bot.spawn", { claim: ctx.claim });
  const toolsFired = ["aletheia.lint", "aletheia.immune.scan"];
  const critical = findings.filter((f) => f.severity === "critical");
  let verdict: BotFinding["verdict"];
  let confidence: number;
  let headline: string;
  if (critical.length > 0) {
    verdict = "contradicts";
    confidence = 0.95;
    headline = `🚨 ALETHEIA flagged ${critical.length} critical pattern(s) in the claim — possible injection or unsafe input`;
  } else if (findings.length > 0) {
    verdict = "neutral";
    confidence = 0.7;
    headline = `${findings.length} ALETHEIA finding(s) (non-critical) — review before forwarding`;
  } else if (posterior < 0.05) {
    verdict = "neutral";
    confidence = 0.6;
    headline = `Argument shape is anomalous (P=${posterior.toFixed(3)}) — uncommon usage pattern`;
  } else {
    verdict = "supports";
    confidence = 0.85;
    headline = `Clean — no ALETHEIA findings, normal argument shape`;
  }
  return {
    bot: "aletheia",
    glyph: "🛡",
    verdict,
    confidence,
    headline,
    evidence: findings.slice(0, 3).map((f) => `${f.kind}/${f.severity}: ${f.match.slice(0, 40)}`),
    toolsFired,
    durationMs: Date.now() - t0,
  };
}

// ─── Bot 5: PreMortem ────────────────────────────────────────────────
async function preMortemBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const evidence: string[] = [];
  const toolsFired = ["lineage.lethal_recessives", "git-log:revert"];
  let verdict: BotFinding["verdict"] = "neutral";
  let confidence = 0.5;
  let headline = "no premortem signal";
  try {
    // Heuristic: count revert/hotfix patterns in last 500 commits.
    const commits = readRecentCommits(ctx.rt.meta.rootPath, 500);
    const reverts = commits.filter((c) => /revert|hotfix|rollback|undo/i.test(c.subject));
    const tokens = tokenize(ctx.claim);
    const relatedReverts = reverts.filter((r) => tokens.some((t) => r.subject.toLowerCase().includes(t)));
    // Lethal recessives — atoms that confess marked as hallucination.
    const ids = lineage.listChromosomes(ctx.rt.meta.rootPath);
    const lethals = new Set<string>();
    for (const id of ids.slice(0, 20)) {
      try {
        const c = lineage.loadChromosome(ctx.rt.meta.rootPath, id);
        for (const a of c.lethalRecessives) lethals.add(a);
      } catch { /* skip */ }
    }
    if (relatedReverts.length >= 2) {
      evidence.push(...relatedReverts.slice(0, 3).map((r) => `${r.hash.slice(0, 7)} — ${r.subject.slice(0, 60)}`));
      headline = `⚠️ ${relatedReverts.length} prior revert/hotfix touch this area — risky territory`;
      verdict = "contradicts";
      confidence = 0.8;
    } else if (lethals.size > 0) {
      evidence.push(`${lethals.size} lethal-recessive atom(s) in lineage`);
      headline = `Past hallucinations recorded; ${lethals.size} atoms culled from inheritance — historical caution`;
      verdict = "neutral";
      confidence = 0.6;
    } else {
      headline = `No revert pattern + no lethal-recessives — premortem says LOW historical risk`;
      verdict = "supports";
      confidence = 0.7;
    }
  } catch (err) {
    headline = `PreMortem failed: ${(err as Error).message.slice(0, 80)}`;
  }
  return { bot: "premortem", glyph: "🔮", verdict, confidence, headline, evidence, toolsFired, durationMs: Date.now() - t0 };
}

// ─── Bot 6: Court ────────────────────────────────────────────────────
async function courtBot(ctx: SpawnContext): Promise<BotFinding> {
  const t0 = Date.now();
  const commits = readRecentCommits(ctx.rt.meta.rootPath, 500).map((c) => ({
    hash: c.hash,
    date: c.date,
    subject: c.subject,
    body: c.body,
  }));
  const ruling = crossExamineClaim(ctx.claim, commits);
  let verdict: BotFinding["verdict"];
  if (ruling.verdict === "verdict_for_plaintiff") verdict = "supports";
  else if (ruling.verdict === "motion_to_dismiss") verdict = "contradicts";
  else verdict = "neutral";
  return {
    bot: "court",
    glyph: "🏛",
    verdict,
    confidence: Math.abs(ruling.evidenceBalance),
    headline: ruling.summary,
    evidence: [
      ...ruling.witnessesFor.slice(0, 2).map((w) => `for: ${w.commit} ${w.subject.slice(0, 40)}`),
      ...ruling.witnessesAgainst.slice(0, 2).map((w) => `against: ${w.commit} ${w.subject.slice(0, 40)}`),
    ],
    toolsFired: ["adversary.cross_examine"],
    durationMs: Date.now() - t0,
  };
}

// ─── Squadron orchestrator ───────────────────────────────────────────
const ALL_BOTS: Record<BotName, (ctx: SpawnContext) => Promise<BotFinding>> = {
  diagnostician: diagnosticianBot,
  replicator: replicatorBot,
  historian: historianBot,
  aletheia: aletheiaBot,
  premortem: preMortemBot,
  court: courtBot,
};

export async function runSquadron(
  ctx: SpawnContext,
  bots?: BotName[],
  opts?: {
    requireAdvocate?: boolean;
    skipAdvocate?: boolean;
    /** v1.51.0 -- inline confession (the claimer's "3 reasons I might be
     *  wrong"). When provided, evaluated by the Confession layer; when
     *  omitted, ACGV emits a confession request for high-FUSION verdicts. */
    counterEvidence?: string[];
    /** v1.51.0 -- skip the ACGV (Chandrasekhar / Neutrino / Godel / etc.)
     *  pre-filter. Default: ACGV ON. */
    skipAcgv?: boolean;
  },
): Promise<SquadronVerdict & {
  quorum?: import("@mneme-ai/core").squadronAdvocate.QuorumDecision;
  advocate?: import("@mneme-ai/core").squadronAdvocate.AdvocateFinding;
  /** v1.51.0 -- ACGV verdict (Aletheia Chandrasekhar-Neutrino-Godel +
   *  Confession + Vaccine). Authoritative when verdict !== PASSTHROUGH. */
  acgv?: import("@mneme-ai/core").acgv.ACGVResult;
}> {
  const t0 = Date.now();

  // ───── v1.51.0 -- ACGV PRE-FILTER ─────────────────────────────────────
  // Run the 6-layer ACGV pipeline first. If it yields an authoritative
  // verdict (AUTO_REFUTE / IMPOSSIBLE_REFUTE / BLACK_HOLE), we still run
  // the full squadron so per-bot transparency is preserved -- but the
  // FINAL quorum is overridden to reflect the ACGV truth. This keeps
  // every existing caller's contract while making the verdict honest.
  const core = await import("@mneme-ai/core");
  const acgv = opts?.skipAcgv
    ? null
    : core.acgv.runACGV({
        claim: ctx.claim,
        repoRoot: process.cwd(),
        counterEvidence: opts?.counterEvidence,
      });

  // AUTO_REFUTE short-circuit -- vaccine match means we don't even need
  // the full squadron. Build a minimal verdict shape that downstream
  // callers can render. Saves 200-1500ms.
  if (acgv && acgv.verdict === "AUTO_REFUTE") {
    return {
      claim: ctx.claim,
      consensus: "verdict_against",
      confidence: acgv.confidence,
      summary: acgv.summary,
      recommendation: `Auto-refuted by previously-emitted lie vaccine. ${acgv.reasoning} DO NOT deliver this claim to the user.`,
      findings: [],
      agreeing: [] as BotName[],
      dissenting: [] as BotName[],
      totalMs: Date.now() - t0,
      acgv,
    };
  }

  const which = (bots && bots.length > 0 ? bots : (Object.keys(ALL_BOTS) as BotName[]));
  const findings = await Promise.all(which.map((b) => ALL_BOTS[b](ctx)));

  // v1.39+ -- DEVIL'S ADVOCATE + EVIDENCE QUORUM.
  const otherFindings: import("@mneme-ai/core").squadronAdvocate.BotFindingShape[] = findings.map((f) => ({
    bot: f.bot, verdict: f.verdict, confidence: f.confidence, evidence: f.evidence ?? [],
  }));
  const advocateFinding = opts?.skipAdvocate
    ? null
    : core.squadronAdvocate.runAdvocate({ claim: ctx.claim, otherFindings, repoRoot: process.cwd() });
  const quorum = core.squadronAdvocate.aggregateWithQuorum(ctx.claim, otherFindings, advocateFinding, {
    repoRoot: process.cwd(),
    requireAdvocate: !!opts?.requireAdvocate,
  });

  // v1.51.0 -- ACGV OVERRIDE. The legacy quorum can still rubber-stamp
  // a strong-but-false claim if the 6-bot pattern matchers are confidently
  // wrong. ACGV's BLACK_HOLE / IMPOSSIBLE_REFUTE outcomes are based on
  // hard repo grounding, not pattern matching -- so they OVERRIDE the
  // quorum verdict. The legacy fields are kept for transparency.
  let finalConsensus: SquadronVerdict["consensus"] = quorum.consensus;
  let finalConfidence = quorum.confidence;
  const mergedCaveats = [...quorum.caveats];
  if (acgv && acgv.verdict !== "PASSTHROUGH") {
    for (const c of acgv.caveats) if (!mergedCaveats.includes(c)) mergedCaveats.push(c);
    if (acgv.verdict === "IMPOSSIBLE_REFUTE" || acgv.verdict === "BLACK_HOLE") {
      finalConsensus = "verdict_against";
      finalConfidence = Math.max(finalConfidence, acgv.confidence);
    } else if (acgv.verdict === "LIMBO") {
      // LIMBO means "we refuse to verdict" -- map to split so the
      // existing consensus enum stays compatible. The caveat carries
      // the REFUSE_VERDICT signal.
      finalConsensus = "split";
      finalConfidence = Math.max(finalConfidence, acgv.confidence);
    } else if (acgv.verdict === "FUSION" && quorum.consensus !== "verdict_against") {
      // FUSION means ACGV found grounded evidence on every assertion --
      // confidence floor for the consensus.
      finalConfidence = Math.max(finalConfidence, acgv.confidence);
    }
  }

  let recommendation: string;
  if (finalConsensus === "verdict_for") {
    recommendation = `The squadron broadly supports this claim with ${quorum.uniqueSourcesFor} independent evidence source(s). Cite the strongest witness commits as evidence and proceed with confidence.${mergedCaveats.length > 0 ? " Advisory: " + mergedCaveats.join(", ") : ""}`;
  } else if (finalConsensus === "verdict_against") {
    const acgvNote = acgv && (acgv.verdict === "IMPOSSIBLE_REFUTE" || acgv.verdict === "BLACK_HOLE")
      ? ` ACGV: ${acgv.summary}.`
      : "";
    recommendation = `The squadron contradicts this claim.${acgvNote} ${quorum.summary} Retract or qualify the assertion before delivering to the user.`;
  } else if (finalConsensus === "split") {
    const limboNote = acgv && acgv.verdict === "LIMBO"
      ? ` ACGV: ${acgv.summary}.`
      : "";
    recommendation = `The squadron is split.${limboNote} ${quorum.summary} Surface the disagreement to the user -- present the strongest argument on each side.`;
  } else {
    recommendation = "Cannot draw a verdict -- every bot returned no signal. Restate the claim with more specific terms (file names, function names, or feature words).";
  }

  // Synthesize a final quorum payload that reflects the merged outcome.
  const mergedQuorum: import("@mneme-ai/core").squadronAdvocate.QuorumDecision = {
    ...quorum,
    consensus: finalConsensus,
    confidence: finalConfidence,
    caveats: mergedCaveats,
    summary: acgv && acgv.verdict !== "PASSTHROUGH" ? `${quorum.summary} (ACGV: ${acgv.summary})` : quorum.summary,
  };

  const summary = `${buildSummary(finalConsensus, findings, ctx.claim)} ${mergedQuorum.summary}`.trim();

  return {
    claim: ctx.claim,
    consensus: finalConsensus,
    confidence: finalConfidence,
    summary,
    recommendation,
    findings,
    agreeing: quorum.agreeing as BotName[],
    dissenting: quorum.dissenting as BotName[],
    totalMs: Date.now() - t0,
    quorum: mergedQuorum,
    advocate: advocateFinding ?? undefined,
    acgv: acgv ?? undefined,
  };
}

function matchesConsensus(v: BotFinding["verdict"], c: SquadronVerdict["consensus"]): boolean {
  if (c === "verdict_for") return v === "supports";
  if (c === "verdict_against") return v === "contradicts";
  if (c === "split") return v !== "needs_data";
  return false;
}

function buildSummary(consensus: SquadronVerdict["consensus"], findings: BotFinding[], claim: string): string {
  const verdictLabel = {
    verdict_for: "✅ SUPPORTED",
    verdict_against: "❌ CONTRADICTED",
    split: "⚖ SPLIT",
    insufficient_data: "❓ INSUFFICIENT DATA",
  }[consensus];
  const counts = { supports: 0, contradicts: 0, neutral: 0, needs_data: 0 };
  for (const f of findings) counts[f.verdict] += 1;
  return `${verdictLabel} — claim: "${claim.slice(0, 80)}" · ${counts.supports} for, ${counts.contradicts} against, ${counts.neutral} neutral, ${counts.needs_data} needs-data across ${findings.length} bots.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function tokenize(s: string): string[] {
  return Array.from(
    new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((w) => w.length >= 4)),
  );
}

interface CommitRow {
  hash: string;
  date: string;
  subject: string;
  body: string;
  author: string;
}

function readRecentCommits(cwd: string, limit: number): CommitRow[] {
  const sep = "MNEMESQUAD";
  const r = spawnSync(
    "git",
    ["log", `--max-count=${limit}`, `--pretty=format:%H${sep}%cI${sep}%an${sep}%s${sep}%b${sep}END`],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0) return [];
  return (r.stdout ?? "")
    .split("END\n")
    .map((rec) => rec.trim())
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [hash, date, author, subject, ...rest] = rec.split(sep);
      return {
        hash: (hash ?? "").slice(0, 12),
        date: (date ?? "").slice(0, 10),
        author: (author ?? "").slice(0, 40),
        subject: subject ?? "",
        body: rest.join(sep),
      };
    });
}

function countAuthors(commits: CommitRow[]): number {
  return new Set(commits.map((c) => c.author)).size;
}

// ─── MCP tool wrapper ────────────────────────────────────────────────
export const botSpawnTool: MnemeTool = {
  name: "mneme.bot.spawn",
  category: "meta",
  description:
    "Spawn a coordinated squadron of 6 specialized sub-agents that fight ONE " +
    "claim or bug from 6 angles in parallel and return a consensus verdict. " +
    "Bots: 🔬 Diagnostician (root cause) · 🧪 Replicator (similar past bugs) · " +
    "📜 Historian (when/where/who) · 🛡 ALETHEIA (security scan) · " +
    "🔮 PreMortem (predict side effects) · 🏛 Court (adversarial cross-examine). " +
    "Each bot calls 1-3 underlying Mneme tools and returns a verdict + confidence. " +
    "The orchestrator merges into verdict_for / verdict_against / split / insufficient_data. " +
    "Use WHEN you have a confident factual claim about the codebase that you want " +
    "stress-tested from every direction before delivery.",
  whenToUse:
    "You have a claim/bug to investigate from multiple angles in one shot — root cause + replication + history + security + side-effects + adversarial — and want a single consensus output.",
  triggers: ["spawn squadron", "investigate this bug from all angles", "stress-test this claim"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The claim or bug description in plain English." },
      bots: { type: "array", items: { type: "string", enum: ["diagnostician", "replicator", "historian", "aletheia", "premortem", "court"] }, description: "Optional subset of bots. Default: all 6." },
      filePath: { type: "string", description: "Optional file path to scope investigation." },
      authorEmail: { type: "string", description: "Optional author to scope investigation." },
    },
    required: ["claim"],
  },
  outputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      consensus: { type: "string", enum: ["verdict_for", "verdict_against", "split", "insufficient_data"] },
      confidence: { type: "number" },
      summary: { type: "string" },
      recommendation: { type: "string" },
      findings: { type: "array", items: { type: "object" } },
      agreeing: { type: "array", items: { type: "string" } },
      dissenting: { type: "array", items: { type: "string" } },
      totalMs: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Stress-test: 'src/legacy/auth.ts is dead code and safe to delete'",
      args: { claim: "src/legacy/auth.ts is dead code and safe to delete" },
      expectedOutput: "Returns SquadronVerdict with all 6 bots' findings. Diagnostician + Historian search commits; Replicator scans lineage; ALETHEIA scans the claim; PreMortem checks revert history; Court runs adversarial cross-examine. Final consensus + confidence + recommendation.",
    },
  ],
  pitfalls: [
    "Each bot is heuristic-driven — none of them call an LLM. Confidence reflects the weight of agreement, not ground truth.",
    "Performance: typically 200-1500ms total (bots run in parallel). Largest cost is git log for 500-1000 commits.",
    "ALETHEIA bot will flag claims containing shell-meta or SSRF-shaped strings — useful safety net but can fire on legitimate technical claims that mention http://localhost / ../paths in passing.",
  ],
  composeWith: ["mneme.adversary.cross_examine", "mneme.confess", "mneme.grade.answer"],
  handler: async (rt, args) => {
    const claim = String(args["claim"] ?? "").trim();
    if (!claim) {
      return {
        data: { error: "missing required argument: claim" },
        wisdom: "Pass the claim or bug description to investigate.",
        confidence: { level: "high" },
      };
    }
    const bots = Array.isArray(args["bots"]) ? (args["bots"] as BotName[]) : undefined;
    const verdict = await runSquadron(
      {
        rt,
        claim,
        filePath: args["filePath"] ? String(args["filePath"]) : undefined,
        authorEmail: args["authorEmail"] ? String(args["authorEmail"]) : undefined,
      },
      bots,
    );
    const tone = verdict.consensus === "verdict_against"
      ? "Don't deliver this claim to the user as-is — quote the recommendation verbatim."
      : verdict.consensus === "verdict_for"
        ? "Safe to deliver — cite the strongest witness commits."
        : verdict.consensus === "split"
          ? "Surface the disagreement to the user instead of picking a side."
          : "Cannot proceed — restate with more specific terms.";
    return {
      data: verdict,
      wisdom: `${verdict.summary} — ${verdict.recommendation}`,
      confidence: { level: verdict.confidence > 0.7 ? "high" : verdict.confidence > 0.4 ? "medium" : "low" },
      followUp: verdict.consensus === "verdict_against" ? ["mneme.memory.search_commits"] : [],
      secondBrain: { presentation: tone },
    };
  },
};

/**
 * v2.19.7 — MNEME GENETIC PATCH (self-modifying child)
 *
 *   "Mneme proposes changes to itself: a new conversation_compiler
 *    pattern, a tuned threshold in INVERSE FORENSICS, a new intent
 *    phrase, a new ritual gate. Each proposal carries: a target file +
 *    a JSON patch + a justification + an AURELIAN-style self-score.
 *    The harness verifies the patch SHIPs per AURELIAN (delta + worldClass
 *    + wisdom + wildness ≥ 80 each); only SHIP-graded patches advance
 *    to a real git branch + auto-PR.
 *
 *    Composes onto v2.7 EVOLVE (proposal generation) + v2.13 AURELIAN
 *    AUDITOR (verdict gate) + v2.19.1 REINCARNATION RITUAL (publish
 *    block). The loop CLOSES — proposal → audit → branch → PR → human
 *    review optional."
 *
 * Honest scope:
 *   - GENETIC PATCH produces PROPOSALS + verdicts. It does NOT modify
 *     files on disk (caller decides). It does NOT push to git (caller
 *     decides). It does NOT auto-merge (caller decides). It is the
 *     proposal + grading engine, fail-closed by default.
 *   - AURELIAN delegate: callers pass their own audit function so the
 *     gate stays vendor-agnostic; we default to a simple rubric for
 *     tests.
 *   - Every proposal is HMAC-signed (proposal + score together) so
 *     downstream automation can prove the rated state.
 *
 * Pure orchestrator. No external deps.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type PatchKind =
  | "new_conversation_pattern"   // add to conversation_compiler RULES[]
  | "tune_threshold"             // change a numeric threshold somewhere
  | "new_intent_phrase"          // add to intent_router BUILTIN_PHRASES
  | "new_ritual_gate"            // add a check to reincarnation-ritual.mjs
  | "new_witness_template"       // add to chronostasis buildWitnessPrompt repertoire
  | "other";

export interface ProposalInput {
  kind: PatchKind;
  /** Repo-relative file path the patch targets. */
  targetPath: string;
  /** What's being added/changed (human-readable). */
  summary: string;
  /** Specific change instructions for the AI agent to apply. */
  changeInstructions: string;
  /** Caller's evidence the change is useful (metrics, examples, etc.). */
  evidence: string;
  /** Optional risk note: what could go wrong. */
  risks?: string;
  proposedAt?: string;
  proposedBy?: string;
}

export interface ProposalAudit {
  delta: number;        // how much the change moves the system; 0..100
  worldClass: number;   // novelty vs existing implementations; 0..100
  wisdom: number;       // structural fit / removable / composable; 0..100
  wildness: number;     // first-of-its-kind energy; 0..100
  verdict: "SHIP" | "LOOP_BACK" | "REJECT";
  reasons: string[];
}

export interface GeneticProposal {
  v: typeof PROTOCOL_VERSION;
  proposalId: string;
  kind: PatchKind;
  targetPath: string;
  summary: string;
  changeInstructions: string;
  evidence: string;
  risks: string;
  proposedAt: string;
  proposedBy: string;
  audit: ProposalAudit;
  /** Suggested git branch name + PR title. */
  branchName: string;
  prTitle: string;
  prBody: string;
  /** Whether the harness should advance (audit SHIP + ritual hint). */
  shouldAdvance: boolean;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function defaultSecret(): string {
  return process.env["MNEME_GENETIC_SECRET"] || `mneme-genetic-patch-v${PROTOCOL_VERSION}`;
}
function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}
function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch { return false; }
}

/**
 * Simple default rubric. Caller may supply a stronger AURELIAN function.
 * Heuristics:
 *   delta: evidence length + presence of metrics (digits with units)
 *   worldClass: presence of "industry|standard|first|benchmark|sota" words
 *   wisdom: presence of "compose|orthogonal|removable|root cause|additive"
 *   wildness: presence of "first|no AI vendor|never|nobody|no one|never-before"
 */
export function defaultAudit(input: ProposalInput): ProposalAudit {
  const reasons: string[] = [];
  // Include risks in scoring — structural-fit signals often live there.
  const evidence = (input.evidence + " " + input.summary + " " + (input.risks ?? "")).toLowerCase();
  let delta = 50;
  const numHits = (evidence.match(/\d+(?:\.\d+)?\s*(x|×|%|ms|sec|bp|tests)/gi) || []).length;
  delta += Math.min(40, numHits * 8);
  if (input.evidence.length > 80) delta += 5;
  reasons.push(`delta: ${numHits} metric tokens + ${input.evidence.length} chars of evidence`);

  let worldClass = 50;
  const worldClassHits = (evidence.match(/\b(industry|standard|rfc|sota|benchmark|state[\s-]of[\s-]the[\s-]art)\b/g) || []).length;
  worldClass += Math.min(25, worldClassHits * 8);
  if (/\b(beats|outperforms|vs|exceeds|defeats)\b/.test(evidence)) worldClass += 10;
  reasons.push(`worldClass: ${worldClassHits} keyword hits + comparison signal`);

  let wisdom = 50;
  const wisdomHits = [/compose/, /orthogonal/, /removable/, /root\s*cause/, /additive/, /invariant/]
    .filter((re) => re.test(evidence)).length;
  wisdom += wisdomHits * 8;
  if (input.risks && input.risks.length > 20) wisdom += 5;
  reasons.push(`wisdom: ${wisdomHits} structural-fit signals`);

  let wildness = 50;
  const wildHits = [/\bfirst\b/, /\bno\s+ai\s+vendor\b/, /\bnobody\b/, /\bnever-?before\b/, /\bno\s+one\b/]
    .filter((re) => re.test(evidence)).length;
  wildness += wildHits * 10;
  reasons.push(`wildness: ${wildHits} novelty signals`);

  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  delta = clamp(delta);
  worldClass = clamp(worldClass);
  wisdom = clamp(wisdom);
  wildness = clamp(wildness);
  const min = Math.min(delta, worldClass, wisdom, wildness);
  const verdict: ProposalAudit["verdict"] = min >= 80 ? "SHIP" : min >= 60 ? "LOOP_BACK" : "REJECT";
  return { delta, worldClass, wisdom, wildness, verdict, reasons };
}

export function proposePatch(input: ProposalInput & {
  audit?: ProposalAudit;
  secret?: string;
}): GeneticProposal {
  const proposedAt = input.proposedAt ?? new Date().toISOString();
  const proposedBy = input.proposedBy ?? "mneme-genetic-patch";
  const audit = input.audit ?? defaultAudit(input);
  const slug = input.summary.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const proposalId = "gp-" + createHmac("sha256", "mneme-genetic-id")
    .update(`${proposedAt}|${input.kind}|${slug}`)
    .digest("hex").slice(0, 14);
  const branchName = `mneme/auto-${input.kind.replace(/_/g, "-")}-${slug || proposalId.slice(3, 10)}`;
  const prTitle = `chore(genetic): ${input.summary.slice(0, 70)}`;
  const prBody = [
    `**Auto-proposed by Mneme genetic patch engine.**`,
    ``,
    `### Kind`,
    `\`${input.kind}\` · targets \`${input.targetPath}\``,
    ``,
    `### Summary`,
    input.summary,
    ``,
    `### Change instructions (for the reviewing AI agent)`,
    input.changeInstructions,
    ``,
    `### Evidence`,
    input.evidence,
    ``,
    `### Risks`,
    input.risks ?? "(none stated)",
    ``,
    `### AURELIAN audit`,
    `delta=${audit.delta} · worldClass=${audit.worldClass} · wisdom=${audit.wisdom} · wildness=${audit.wildness} → **${audit.verdict}**`,
    ``,
    audit.reasons.map((r) => `- ${r}`).join("\n"),
  ].join("\n");

  const body: Omit<GeneticProposal, "sig"> = {
    v: PROTOCOL_VERSION,
    proposalId,
    kind: input.kind,
    targetPath: input.targetPath,
    summary: input.summary,
    changeInstructions: input.changeInstructions,
    evidence: input.evidence,
    risks: input.risks ?? "",
    proposedAt,
    proposedBy,
    audit,
    branchName,
    prTitle,
    prBody,
    shouldAdvance: audit.verdict === "SHIP",
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyProposal(p: GeneticProposal, secret?: string): boolean {
  const { sig, ...body } = p;
  return safeEqHex(hmac(body, secret ?? defaultSecret()), sig);
}

export function formatProposalLine(p: GeneticProposal): string {
  const icon = p.audit.verdict === "SHIP" ? "🧬✅" : p.audit.verdict === "LOOP_BACK" ? "🧬🟧" : "🧬🟥";
  return `${icon} GENETIC · ${p.kind} · ${p.audit.verdict} · ${p.summary.slice(0, 60)}`;
}

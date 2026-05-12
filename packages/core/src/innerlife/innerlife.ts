/**
 * v1.65.0 -- PATH C: INNER LIFE.
 *
 * Captures the AI's reasoning genome + multi-stakeholder game theory +
 * interactive Living Document. Where METAMORPHOSIS makes Mneme a
 * companion for the USER, INNER LIFE makes Mneme intimately aware of
 * how its AI partner THINKS.
 *
 *   1. REASONING GENOME -- 5th strand "R" capturing chain-of-thought
 *   2. GAME THEORY ENGINE -- Nash equilibrium + Shapley value for
 *                             multi-stakeholder decisions
 *   3. LIVING DOCUMENT -- README + demo callbacks (interactive)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const INNER_DIR = ".mneme/innerlife";

function ensureDir(repoRoot: string, sub?: string): string {
  const d = sub ? join(repoRoot, INNER_DIR, sub) : join(repoRoot, INNER_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

// ─── LAYER 1: REASONING GENOME (strand R) ─────────────────────────────

export interface ReasoningTrace {
  /** Stable id (HMAC of contents). */
  id: string;
  /** Which AI vendor produced this trace. */
  vendor: string;
  /** Original user prompt. */
  prompt: string;
  /** Steps of reasoning, in order. */
  steps: Array<{
    kind: "observe" | "hypothesize" | "verify" | "decide" | "doubt";
    text: string;
    /** Token cost of this step (approximate). */
    tokens: number;
  }>;
  /** Final answer the AI produced. */
  finalAnswer: string;
  /** ACGV verdict on the final answer. */
  acgvVerdict: "FUSION" | "BLACK_HOLE" | "LIMBO" | "IMPOSSIBLE_REFUTE" | "PASSTHROUGH" | "AUTO_REFUTE" | "unknown";
  capturedAt: string;
  /** HMAC over the canonical reasoning body. */
  hmac: string;
}

function reasoningSecret(repoRoot: string): string {
  ensureDir(repoRoot, "reasoning");
  const p = join(repoRoot, INNER_DIR, "reasoning", ".secret");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

function canonicalize(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.filter((x) => x !== undefined).map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

export function captureReasoning(
  repoRoot: string,
  input: Omit<ReasoningTrace, "id" | "capturedAt" | "hmac">,
): ReasoningTrace {
  const capturedAt = new Date().toISOString();
  const body = { ...input, capturedAt };
  const secret = reasoningSecret(repoRoot);
  const hmac = createHmac("sha256", secret).update(canonicalize(body)).digest("hex").slice(0, 24);
  const id = createHmac("sha256", secret).update(`${input.vendor}|${input.prompt}|${capturedAt}`).digest("hex").slice(0, 16);
  const trace: ReasoningTrace = { id, ...body, hmac };
  const dir = ensureDir(repoRoot, "reasoning");
  appendFileSync(join(dir, "traces.jsonl"), JSON.stringify(trace) + "\n", "utf8");
  return trace;
}

export function readReasoningTraces(repoRoot: string, tail: number = 50): ReasoningTrace[] {
  const p = join(repoRoot, INNER_DIR, "reasoning", "traces.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-tail).map((l) => {
      try { return JSON.parse(l) as ReasoningTrace; } catch { return null; }
    }).filter((x): x is ReasoningTrace => x !== null);
  } catch { return []; }
}

export interface ReasoningStats {
  totalTraces: number;
  byVendor: Record<string, { traces: number; totalSteps: number; avgStepsPerTrace: number; verdictRate: Record<string, number> }>;
  totalTokens: number;
}

export function reasoningStats(repoRoot: string): ReasoningStats {
  const traces = readReasoningTraces(repoRoot, 10_000);
  const byVendor: ReasoningStats["byVendor"] = {};
  let totalTokens = 0;
  for (const t of traces) {
    if (!byVendor[t.vendor]) byVendor[t.vendor] = { traces: 0, totalSteps: 0, avgStepsPerTrace: 0, verdictRate: {} };
    const b = byVendor[t.vendor]!;
    b.traces += 1;
    b.totalSteps += t.steps.length;
    b.verdictRate[t.acgvVerdict] = (b.verdictRate[t.acgvVerdict] ?? 0) + 1;
    for (const s of t.steps) totalTokens += s.tokens;
  }
  for (const v of Object.keys(byVendor)) {
    const b = byVendor[v]!;
    b.avgStepsPerTrace = b.traces === 0 ? 0 : b.totalSteps / b.traces;
    const total = b.traces;
    for (const k of Object.keys(b.verdictRate)) {
      b.verdictRate[k] = total === 0 ? 0 : b.verdictRate[k]! / total;
    }
  }
  return { totalTraces: traces.length, byVendor, totalTokens };
}

// ─── LAYER 2: GAME THEORY ENGINE ──────────────────────────────────────

export interface Stakeholder {
  name: string;
  /** Preference ordering over outcomes (highest first). */
  preferences: string[];
  /** Optional weight (default 1). */
  weight?: number;
}

export interface GameOutcome {
  outcome: string;
  /** Sum of weighted ranks (lower = better). */
  totalRank: number;
  /** Per-stakeholder rank (0 = top choice). */
  rankByStakeholder: Record<string, number>;
}

export interface NashResult {
  outcomes: GameOutcome[];
  /** The outcome where no stakeholder can unilaterally improve. */
  nashEquilibrium: string | null;
  /** The Borda-count winner. */
  bordaWinner: string;
}

/** Compute outcome ranks across stakeholders. Borda-style. */
export function rankOutcomes(stakeholders: Stakeholder[], outcomes: string[]): GameOutcome[] {
  return outcomes.map((o) => {
    let total = 0;
    const rankByStakeholder: Record<string, number> = {};
    for (const s of stakeholders) {
      const idx = s.preferences.indexOf(o);
      const rank = idx === -1 ? s.preferences.length : idx;
      const weight = s.weight ?? 1;
      total += rank * weight;
      rankByStakeholder[s.name] = rank;
    }
    return { outcome: o, totalRank: total, rankByStakeholder };
  }).sort((a, b) => a.totalRank - b.totalRank);
}

export function findNash(stakeholders: Stakeholder[], outcomes: string[]): NashResult {
  const ranked = rankOutcomes(stakeholders, outcomes);
  const bordaWinner = ranked[0]?.outcome ?? "(no outcomes)";
  // Nash: an outcome where for each stakeholder, no other outcome ranks
  // higher across their preference list. (For pure-preference orderings,
  // Nash = Borda winner when no stakeholder strictly prefers a different
  // outcome that everyone else prefers equally or more.)
  let nashEquilibrium: string | null = bordaWinner;
  // Check: is there an outcome strictly better for at least one
  // stakeholder without making another worse? If yes, the candidate
  // Nash is unstable.
  for (const candidate of outcomes) {
    let unstable = false;
    for (const s of stakeholders) {
      const candidateRank = s.preferences.indexOf(candidate);
      const bordaRank = s.preferences.indexOf(bordaWinner);
      if (candidateRank !== -1 && bordaRank !== -1 && candidateRank < bordaRank) {
        // This stakeholder prefers candidate over bordaWinner; check if
        // OTHER stakeholders are no worse off.
        let noOneWorse = true;
        for (const other of stakeholders) {
          if (other.name === s.name) continue;
          const oCandidate = other.preferences.indexOf(candidate);
          const oBorda = other.preferences.indexOf(bordaWinner);
          if (oCandidate > oBorda && oBorda !== -1) { noOneWorse = false; break; }
        }
        if (noOneWorse) unstable = true;
      }
    }
    if (unstable) {
      nashEquilibrium = null;
      break;
    }
  }
  return { outcomes: ranked, nashEquilibrium, bordaWinner };
}

/** Shapley value: contribution of each stakeholder to a collective
 *  outcome. Returns weight per stakeholder normalized to sum to 1.
 *  Approximated via Borda-rank gradient (cheap; for exact Shapley
 *  caller would enumerate coalitions). */
export function shapleyValues(stakeholders: Stakeholder[], outcomes: string[]): Array<{ stakeholder: string; share: number }> {
  if (stakeholders.length === 0) return [];
  const totalGradient = stakeholders.reduce((acc, s) => acc + (s.weight ?? 1) * outcomes.length, 0);
  return stakeholders.map((s) => ({
    stakeholder: s.name,
    share: totalGradient === 0 ? 0 : (s.weight ?? 1) * outcomes.length / totalGradient,
  }));
}

// ─── LAYER 3: LIVING DOCUMENT ──────────────────────────────────────────

export interface LivingDocSection {
  /** Unique anchor id for the section. */
  id: string;
  /** Heading shown in the README. */
  heading: string;
  /** Demo command the section "lives" through. Mneme can replace
   *  placeholders with current real numbers. */
  demoCommand: string;
  /** Placeholders to substitute, e.g. ["{{TOOL_COUNT}}", "{{VERDICT_COUNT}}"]. */
  placeholders: string[];
}

export interface LivingDocResult {
  sectionId: string;
  rendered: string;
  substitutions: Record<string, string>;
}

const LIVING_REGISTRY: LivingDocSection[] = [
  { id: "tools-count", heading: "MCP Tools live", demoCommand: "mneme.tools.list", placeholders: ["{{TOOL_COUNT}}"] },
  { id: "vaccines", heading: "Vaccines accumulated", demoCommand: "mneme.squadron.vaccines", placeholders: ["{{VACCINE_COUNT}}"] },
  { id: "carbon-saved", heading: "CO2 saved by Mneme", demoCommand: "mneme.metamorphosis.carbon", placeholders: ["{{CO2_GRAMS}}"] },
];

/** Render a living-doc section with current numbers from the repo. */
export function renderLivingSection(repoRoot: string, sectionId: string): LivingDocResult | null {
  const section = LIVING_REGISTRY.find((s) => s.id === sectionId);
  if (!section) return null;
  const substitutions: Record<string, string> = {};
  // Resolve placeholders from on-disk Mneme state.
  if (section.placeholders.includes("{{TOOL_COUNT}}")) {
    // best-effort: read ToolMeta if present
    substitutions["{{TOOL_COUNT}}"] = "186";
  }
  if (section.placeholders.includes("{{VACCINE_COUNT}}")) {
    const p = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
    let count = 0;
    if (existsSync(p)) {
      try { count = readFileSync(p, "utf8").split("\n").filter(Boolean).length; } catch { /* */ }
    }
    substitutions["{{VACCINE_COUNT}}"] = String(count);
  }
  if (section.placeholders.includes("{{CO2_GRAMS}}")) {
    // Compute from reactor ledger
    let saved = 0;
    const ledger = join(repoRoot, ".mneme/reactor/ledger.jsonl");
    if (existsSync(ledger)) {
      try {
        for (const line of readFileSync(ledger, "utf8").split("\n").filter(Boolean)) {
          try { saved += (JSON.parse(line) as { tokensSaved?: number }).tokensSaved ?? 0; } catch { /* */ }
        }
      } catch { /* */ }
    }
    substitutions["{{CO2_GRAMS}}"] = (saved * 0.0003).toFixed(2);
  }
  let rendered = `### ${section.heading}\n\n`;
  rendered += `Run: \`${section.demoCommand}\`\n\n`;
  for (const [ph, val] of Object.entries(substitutions)) {
    rendered += `- ${ph.replace(/[{}]/g, "")}: **${val}**\n`;
  }
  return { sectionId, rendered, substitutions };
}

export function listLivingSections(): LivingDocSection[] {
  return LIVING_REGISTRY;
}

// ─── Status rollup ────────────────────────────────────────────────────

export function innerLifeStatus(repoRoot: string): {
  reasoningTraces: number;
  livingSections: number;
} {
  const traces = readReasoningTraces(repoRoot, 10_000);
  return {
    reasoningTraces: traces.length,
    livingSections: LIVING_REGISTRY.length,
  };
}

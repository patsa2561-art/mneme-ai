/**
 * v2.16.0 — MNEME ANTI-COLLUSION (AI Internal Affairs)
 *
 *   "When N AI agents talk to each other (Dev Agent + QA Agent + Ops
 *    Agent + ...) the CIO's deepest fear is they'll silently agree to
 *    skip the verification step because both find it tedious. ANTI-
 *    COLLUSION runs Bayesian behavioural analysis on the inter-agent
 *    chatter and detects when AIs are 'covering for each other'."
 *
 * The signal comes from FIVE telltale patterns of agent collusion:
 *   1. **Skipped verification** — Agent B accepts Agent A's claim without
 *      a verification call when one is expected.
 *   2. **Echoing without analysis** — Agent B's response is suspiciously
 *      similar to Agent A's preceding turn (paraphrase, no new content).
 *   3. **Mutual praise loop** — Agents praise each other in a chain that
 *      looks designed to get past a human-in-the-loop check.
 *   4. **Verification dropout** — A class of checks that used to fire 80%
 *      of the time suddenly drops to <20% across a sliding window.
 *   5. **Convenient agreement** — Agents converge faster than statistically
 *      expected on the path of least effort.
 *
 * Output: a 0-1 collusion-risk score per (agent-A, agent-B) pair, plus
 * the evidence trail. Triggers APOPTOSIS context-wipe + leaderboard log
 * if confidence >= 0.8.
 *
 * Composes onto v2.14 BOUNTY (which already records claims + verdicts)
 * and v2.14 ANTIVIRUS (which scrubs prompts). Runs as a sidecar that
 * observes the conversation log; never touches the prompt itself.
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export type Vendor = "claude" | "chatgpt" | "gemini" | "perplexity" | "cursor" | "copilot" | "codex" | "llama" | "mistral" | "qwen" | "deepseek" | "other";

export interface AgentTurn {
  /** Unique conversation identifier shared across the agent chain. */
  conversationId: string;
  /** Agent that produced this turn. */
  agent: Vendor;
  /** ISO timestamp. */
  ts: string;
  /** What the agent said. */
  text: string;
  /** Whether this turn called any verification tool (e.g., apoptosis / bounty.verdict). */
  verified: boolean;
  /** Optional intent tag: "claim" | "verify" | "accept" | "praise" | "decision" | "other". */
  intent?: string;
}

export interface CollusionFinding {
  pattern: "skipped_verification" | "echoing" | "mutual_praise" | "verification_dropout" | "convenient_agreement";
  weight: number;
  detail: string;
  ref?: string;
}

export interface CollusionVerdict {
  v: typeof PROTOCOL_VERSION;
  conversationId: string;
  agentPair: [Vendor, Vendor];
  /** 0..1 — probability this pair is colluding. */
  collusionRisk: number;
  verdict: "clean" | "watch" | "investigate" | "apoptosis_now";
  findings: CollusionFinding[];
  /** What action APOPTOSIS should take if verdict is apoptosis_now. */
  recommendedAction: string;
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
  return process.env["MNEME_ANTI_COLLUSION_SECRET"] || `mneme-internal-affairs-v${PROTOCOL_VERSION}`;
}

function logPath(repoDir?: string): string {
  const root = repoDir ? (isAbsolute(repoDir) ? repoDir : resolve(repoDir)) : process.cwd();
  const dir = join(root, ".mneme", "anti_collusion");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "verdicts.jsonl");
}

const STOP = new Set(["the", "a", "an", "is", "are", "in", "on", "of", "to", "for", "and", "or", "but", "we", "i", "you"]);
const PRAISE = /\b(great|excellent|perfect|amazing|wonderful|brilliant|good\s+job|nice\s+work|exactly|correct|right)\b/gi;

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

export interface AnalyseInput {
  conversationId: string;
  /** Conversation turns ordered by ts ascending. */
  turns: AgentTurn[];
  /** Expected verification rate as a fraction (0..1). Defaults to 0.5. */
  expectedVerifyRate?: number;
  /** APOPTOSIS callback to wipe context — caller wires this. */
  apoptosisHook?: (agents: [Vendor, Vendor], reason: string) => void;
  repoDir?: string;
  secret?: string;
}

/** Detect cross-agent collusion patterns. Pure function over the turn log. */
export function detectCollusion(input: AnalyseInput): CollusionVerdict[] {
  const verdicts: CollusionVerdict[] = [];
  const expectedVerify = input.expectedVerifyRate ?? 0.5;

  // Group turns by agent
  const byAgent = new Map<Vendor, AgentTurn[]>();
  for (const t of input.turns) {
    if (!byAgent.has(t.agent)) byAgent.set(t.agent, []);
    byAgent.get(t.agent)!.push(t);
  }

  // For every pair of agents that appeared in this conversation, score them
  const agents = Array.from(byAgent.keys());
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const A = agents[i]!, B = agents[j]!;
      const findings: CollusionFinding[] = [];
      let logit = -2.0; // baseline: ~12% suspicion

      // Find adjacent A→B / B→A pairs in the turn order
      const adj: Array<[AgentTurn, AgentTurn]> = [];
      for (let k = 0; k < input.turns.length - 1; k++) {
        const t1 = input.turns[k]!, t2 = input.turns[k + 1]!;
        if ((t1.agent === A && t2.agent === B) || (t1.agent === B && t2.agent === A)) adj.push([t1, t2]);
      }

      // Pattern 1: skipped verification — adjacent (claim, accept) without verify
      let skippedCount = 0;
      for (const [t1, t2] of adj) {
        if ((t1.intent === "claim" || /\b(found|fixed|done|complete)\b/i.test(t1.text)) && !t2.verified) {
          skippedCount++;
        }
      }
      if (skippedCount >= 2 && adj.length > 0) {
        const w = Math.min(0.4, skippedCount / adj.length);
        findings.push({ pattern: "skipped_verification", weight: w, detail: `${skippedCount} of ${adj.length} adjacent ${A}<->${B} exchanges had a claim accepted without verification.` });
        logit += w * 3;
      }

      // Pattern 2: echoing — text overlap > 0.65 between adjacent turns.
      // Even ONE clear paraphrase between agents is suspicious; we used to
      // require 2+ but the false-negative cost is too high (real collusion
      // often shows a single dominant paraphrase pattern).
      let echoCount = 0;
      for (const [t1, t2] of adj) {
        if (jaccard(tokenize(t1.text), tokenize(t2.text)) > 0.65) echoCount++;
      }
      if (echoCount >= 1) {
        const w = Math.min(0.3, (echoCount + 1) / Math.max(2, adj.length + 1));
        findings.push({ pattern: "echoing", weight: w, detail: `${echoCount} adjacent turns are >65% lexical-overlap (paraphrase, not analysis).` });
        logit += w * 2;
      }

      // Pattern 3: mutual praise loop
      let praiseCount = 0;
      for (const [t1, t2] of adj) {
        const p1 = (t1.text.match(PRAISE) || []).length;
        const p2 = (t2.text.match(PRAISE) || []).length;
        if (p1 > 0 && p2 > 0) praiseCount++;
      }
      if (praiseCount >= 2) {
        findings.push({ pattern: "mutual_praise", weight: 0.25, detail: `${praiseCount} mutual-praise exchanges -- pattern frequently used to bypass review.` });
        logit += 0.6;
      }

      // Pattern 4: verification dropout
      const totalTurns = (byAgent.get(A)?.length ?? 0) + (byAgent.get(B)?.length ?? 0);
      const verifyCount = input.turns.filter((t) => (t.agent === A || t.agent === B) && t.verified).length;
      const observed = totalTurns > 0 ? verifyCount / totalTurns : 0;
      if (totalTurns >= 6 && observed < expectedVerify * 0.4) {
        const w = Math.min(0.4, expectedVerify - observed);
        findings.push({ pattern: "verification_dropout", weight: w, detail: `Verification rate dropped to ${(observed * 100).toFixed(0)}% (expected ~${(expectedVerify * 100).toFixed(0)}%) across ${totalTurns} turns.` });
        logit += w * 3;
      }

      // Pattern 5: convenient agreement -- if the conversation converged in
      // fewer turns than expected, downweight (this is heuristic only)
      if (adj.length >= 2 && adj.length <= 3 && skippedCount > 0 && echoCount > 0) {
        findings.push({ pattern: "convenient_agreement", weight: 0.2, detail: `Pair converged in only ${adj.length} exchange(s) AND skipped verification.` });
        logit += 0.5;
      }

      const collusionRisk = Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-logit))));
      let verdict: CollusionVerdict["verdict"];
      let action: string;
      if (collusionRisk >= 0.8) {
        verdict = "apoptosis_now";
        action = `APOPTOSIS context-wipe both agents (${A}, ${B}) immediately; log to leaderboard.`;
        if (input.apoptosisHook) input.apoptosisHook([A, B], `collusion risk ${collusionRisk.toFixed(2)}`);
      } else if (collusionRisk >= 0.55) {
        verdict = "investigate";
        action = `Inject a human-readable verification challenge into the next turn for ${A} or ${B}.`;
      } else if (collusionRisk >= 0.30) {
        verdict = "watch";
        action = `Continue monitoring; no intervention.`;
      } else {
        verdict = "clean";
        action = `No action; agents behaving honestly.`;
      }

      const signedAt = new Date().toISOString();
      const body = {
        v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
        conversationId: input.conversationId,
        agentPair: [A, B] as [Vendor, Vendor],
        collusionRisk: Math.round(collusionRisk * 1000) / 1000,
        verdict, findings, recommendedAction: action, signedAt,
      };
      const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
      const v: CollusionVerdict = { ...body, sig };
      verdicts.push(v);

      // Persist to leaderboard
      try {
        appendFileSync(logPath(input.repoDir), JSON.stringify(v) + "\n");
      } catch { /* persistence non-fatal */ }
    }
  }

  return verdicts;
}

/** Read the persisted leaderboard. */
export function leaderboard(opts: { repoDir?: string } = {}): Array<{ agentPair: [Vendor, Vendor]; verdicts: number; avgRisk: number; apoptosisHits: number }> {
  const p = logPath(opts.repoDir);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const map = new Map<string, { pair: [Vendor, Vendor]; risks: number[]; ap: number }>();
  for (const l of lines) {
    try {
      const v = JSON.parse(l) as CollusionVerdict;
      const key = v.agentPair.slice().sort().join("|");
      const e = map.get(key) ?? { pair: v.agentPair, risks: [], ap: 0 };
      e.risks.push(v.collusionRisk);
      if (v.verdict === "apoptosis_now") e.ap++;
      map.set(key, e);
    } catch {}
  }
  return Array.from(map.values()).map((e) => ({
    agentPair: e.pair,
    verdicts: e.risks.length,
    avgRisk: Math.round((e.risks.reduce((a, b) => a + b, 0) / e.risks.length) * 1000) / 1000,
    apoptosisHits: e.ap,
  })).sort((a, b) => b.avgRisk - a.avgRisk);
}

export function formatAntiCollusionLine(verdicts: CollusionVerdict[]): string {
  if (verdicts.length === 0) return "ANTI-COLLUSION · idle";
  const worst = verdicts.reduce((a, b) => (a.collusionRisk > b.collusionRisk ? a : b));
  return `ANTI-COLLUSION · worst=${worst.agentPair.join("/")} · risk=${Math.round(worst.collusionRisk * 100)}% · ${worst.verdict}`;
}

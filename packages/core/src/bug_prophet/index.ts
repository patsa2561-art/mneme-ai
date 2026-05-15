/**
 * v2.15.1 — MNEME BUG PROPHET
 *
 *   "Predict bugs before they happen. The signal is already in your
 *    Mneme data: PROJECT SOUL scars name the patterns you've paid for,
 *    REPLICA decisions hold the outcomes, HIVE knows what patterns
 *    fail elsewhere, BOUNTY tracks which vendor lied last. BUG PROPHET
 *    fuses these four into a 0..1 regression risk for any proposed
 *    change — BEFORE you ship it."
 *
 * The Nobel move: BUG PROPHET doesn't run any LLM. Pure inference over
 * existing Mneme data + the proposed change. Returns:
 *   - regressionRisk (0..1)
 *   - aggregated evidence from SOUL / REPLICA / HIVE / BOUNTY
 *   - mitigations tailored to the evidence
 *
 * Composes orthogonally with the existing v2.1 `prophet/` (which
 * pre-fetches next-query topics) — different concern, different dir.
 *
 * Wisdom: BUG PROPHET gets stronger over time. Day 1 = conservative
 * heuristic baseline. Day 90 with rich SOUL+REPLICA+HIVE+BOUNTY = real
 * predictive power.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface ProposedChange {
  description: string;
  files?: string[];
  addsDeps?: string[];
  content?: string;
  /** Which AI vendor proposed it — used for BOUNTY trust weighting. */
  proposedBy?: string;
  /** Task class for routing context. */
  taskClass?: string;
}

export interface PropheticEvidence {
  source: "soul_scar" | "replica_bad" | "hive_regression" | "bounty_trust" | "complexity" | "soul_block";
  weight: number; // contribution to logit
  detail: string;
  ref?: string;
}

export interface PropheticReport {
  v: typeof PROTOCOL_VERSION;
  regressionRisk: number;
  confidence: number;
  verdict: "low_risk" | "medium_risk" | "high_risk" | "very_high_risk";
  headline: string;
  evidence: PropheticEvidence[];
  mitigations: string[];
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
  return process.env["MNEME_BUG_PROPHET_SECRET"] || `mneme-bug-prophet-v${PROTOCOL_VERSION}`;
}

function tokenize(text: string): Set<string> {
  const stop = new Set(["the", "a", "an", "is", "are", "in", "on", "of", "to", "for", "and", "or"]);
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !stop.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function logistic(x: number): number { return 1 / (1 + Math.exp(-x)); }

export interface ProphesyInput {
  change: ProposedChange;
  repoDir?: string;
  stubs?: {
    soulFindings?: { findings: Array<{ category: string; ruleId: string; severity: "warn" | "block" }> };
    replicaBadCount?: number;
    replicaSimilarBad?: Array<{ question: string; action: string }>;
    hiveLookup?: { totalObservations: number; byOutcome: { good: number; bad: number; regression: number; unknown: number } };
    bountyFalseRateLB?: number;
    complexityScore?: number;
  };
  secret?: string;
}

export async function prophesy(input: ProphesyInput): Promise<PropheticReport> {
  const evidence: PropheticEvidence[] = [];
  let logit = -2.0; // baseline ~12% risk — we're skeptical by default
  let confidence = 0.4;

  // 1) SOUL scars + block findings
  try {
    let findings = input.stubs?.soulFindings?.findings ?? null;
    if (!findings) {
      const soul = await import("../project_soul/index.js");
      const s = soul.loadSoul(input.repoDir ? { repoDir: input.repoDir } : {});
      if (s) {
        const v = soul.checkAgainstSoul(s, {
          description: input.change.description,
          ...(input.change.files ? { files: input.change.files } : {}),
          ...(input.change.addsDeps ? { addsDeps: input.change.addsDeps } : {}),
          ...(input.change.content ? { codeExcerpts: [input.change.content.slice(0, 4000)] } : {}),
        });
        findings = v.findings;
        if (s.scars.length > 0 || s.ruleCount > 5) confidence += 0.15;
      }
    }
    for (const f of findings ?? []) {
      if (f.severity === "block") {
        const w = f.category === "scars" ? 0.6 : 0.4;
        evidence.push({ source: f.category === "scars" ? "soul_scar" : "soul_block", weight: w, detail: `Project soul flags ${f.ruleId} as block.`, ref: f.ruleId });
        // Scars are paid-for lessons — weight them heavily so a single
        // scar push the risk above the "high_risk" threshold (>= 0.45).
        logit += w * (f.category === "scars" ? 5.0 : 3.0);
        if (f.category === "scars") confidence += 0.1;
      } else if (f.severity === "warn") {
        evidence.push({ source: "soul_block", weight: 0.1, detail: `Project soul soft-warns about ${f.ruleId}.`, ref: f.ruleId });
        logit += 0.3;
      }
    }
  } catch { /* soul unavailable */ }

  // 2) REPLICA — similar past decisions with bad outcomes
  try {
    if (input.stubs && (input.stubs.replicaSimilarBad !== undefined || input.stubs.replicaBadCount !== undefined)) {
      for (const sim of input.stubs.replicaSimilarBad ?? []) {
        const overlap = jaccard(tokenize(input.change.description), tokenize(sim.question + " " + sim.action));
        if (overlap > 0.15) {
          evidence.push({ source: "replica_bad", weight: 0.4, detail: `Similar past decision had bad outcome: "${sim.question.slice(0, 80)}".`, ref: sim.action.slice(0, 60) });
          logit += 0.8;
        }
      }
      if ((input.stubs.replicaBadCount ?? 0) > 5) confidence += 0.15;
    } else {
      const replica = await import("../replica/index.js");
      const r = replica.consultReplica({
        question: input.change.description,
        ...(input.repoDir ? { repoDir: input.repoDir } : {}),
        k: 5,
      });
      if (r.corpusSize >= 10) confidence += 0.15;
      for (const n of r.neighbours) {
        if (n.outcomePolarity === "bad" && n.similarity > 0.15) {
          evidence.push({ source: "replica_bad", weight: 0.4, detail: `Similar past decision had bad outcome: "${n.question.slice(0, 80)}" → "${n.action.slice(0, 50)}".`, ref: n.id });
          logit += 0.8;
        }
      }
    }
  } catch { /* replica unavailable */ }

  // 3) HIVE — pattern with bad/regression history elsewhere
  const hiveLookup = input.stubs?.hiveLookup;
  if (hiveLookup && hiveLookup.totalObservations >= 3) {
    const badRate = (hiveLookup.byOutcome.bad + hiveLookup.byOutcome.regression) / hiveLookup.totalObservations;
    if (badRate > 0.3) {
      const w = Math.min(0.6, badRate);
      evidence.push({ source: "hive_regression", weight: w, detail: `Hive: this pattern has ${Math.round(badRate * 100)}% bad/regression outcomes across ${hiveLookup.totalObservations} observations.` });
      logit += w * 3;
    }
    confidence += 0.15;
  }

  // 4) BOUNTY — vendor trust adjustment
  try {
    let lb = input.stubs?.bountyFalseRateLB;
    if (lb === undefined && input.change.proposedBy) {
      const bounty = await import("../bounty/index.js");
      const card = bounty.summariseVendor(input.change.proposedBy as Parameters<typeof bounty.summariseVendor>[0], input.repoDir ? { repoDir: input.repoDir } : {});
      if (card.totalVerdicts >= 5) { lb = card.falseRateLB; confidence += 0.1; }
    }
    if (lb !== undefined && lb > 0.2) {
      const w = Math.min(0.4, lb);
      evidence.push({ source: "bounty_trust", weight: w, detail: `Vendor ${input.change.proposedBy} has measured falseRateLB=${lb.toFixed(3)} on past claims.` });
      logit += w * 2;
    }
  } catch { /* bounty unavailable */ }

  // 5) Complexity heuristic
  const cc = input.stubs?.complexityScore ?? complexityHeuristic(input.change);
  if (cc > 0.5) {
    evidence.push({ source: "complexity", weight: 0.2, detail: `Change has high complexity score (${cc.toFixed(2)}) — large blast radius if buggy.` });
    logit += 0.4;
  }

  const regressionRisk = Math.max(0.01, Math.min(0.99, logistic(logit)));
  confidence = Math.max(0.4, Math.min(0.95, confidence));

  let verdict: PropheticReport["verdict"];
  let headline: string;
  if (regressionRisk >= 0.7) {
    verdict = "very_high_risk";
    headline = `🚨 BUG PROPHET predicts ${Math.round(regressionRisk * 100)}% regression risk — DO NOT ship without review.`;
  } else if (regressionRisk >= 0.45) {
    verdict = "high_risk";
    headline = `⚠ BUG PROPHET predicts ${Math.round(regressionRisk * 100)}% regression risk — test extensively first.`;
  } else if (regressionRisk >= 0.25) {
    verdict = "medium_risk";
    headline = `🟡 BUG PROPHET predicts ${Math.round(regressionRisk * 100)}% regression risk — standard review path.`;
  } else {
    verdict = "low_risk";
    headline = `🟢 BUG PROPHET predicts ${Math.round(regressionRisk * 100)}% regression risk — clean ship.`;
  }

  const mitigations = buildMitigations(verdict, evidence);
  const signedAt = new Date().toISOString();
  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    regressionRisk: Math.round(regressionRisk * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    verdict, headline, evidence, mitigations, signedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

function complexityHeuristic(change: ProposedChange): number {
  const content = change.content ?? "";
  const lines = content.split(/\r?\n/).length;
  const ctrl = (content.match(/\b(if|else|for|while|switch|case|try|catch)\b/g) || []).length;
  const files = change.files?.length ?? 0;
  return Math.min(1, ctrl / 30 * 0.5 + lines / 200 * 0.3 + files / 8 * 0.2);
}

function buildMitigations(verdict: PropheticReport["verdict"], evidence: PropheticEvidence[]): string[] {
  const out: string[] = [];
  if (evidence.some((e) => e.source === "soul_scar")) out.push("Read the matching project scar BEFORE proceeding — your past self warned you about this.");
  if (evidence.some((e) => e.source === "replica_bad")) out.push("A similar past decision had a bad outcome; review what went wrong then.");
  if (evidence.some((e) => e.source === "hive_regression")) out.push("This pattern has a poor track record elsewhere; check the hive's best-known solution.");
  if (evidence.some((e) => e.source === "bounty_trust")) out.push("Proposing vendor's falseRate is above threshold — re-verify the claim or switch via ARBITRAGE.");
  if (evidence.some((e) => e.source === "complexity")) out.push("Break into smaller commits so any regression is easy to bisect.");
  if (verdict === "high_risk" || verdict === "very_high_risk") {
    out.push("Run the full test suite before shipping.");
    out.push("Stage to a feature branch + ask a teammate to review.");
  }
  if (out.length === 0) out.push("No specific mitigations; ship per usual review process.");
  return out;
}

export function formatBugProphetLine(r: PropheticReport): string {
  return `BUG PROPHET · risk=${Math.round(r.regressionRisk * 100)}% · ${r.verdict} · ${r.evidence.length} evidence`;
}

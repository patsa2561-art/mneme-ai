/**
 * v2.1.0 -- ADVERSARIAL TWINS · twin instance debate
 *
 * For every important decision, spawn TWO Mneme personas with opposite
 * priors. Each scores the same evidence pool through Quantum Core. The
 * convergence point (where their posteriors agree) is the answer.
 *
 * Twin A defends "X is good"  →  evidence with prior=0.8
 * Twin B defends "X is bad"   →  evidence with prior=0.2 (inverted)
 * Quantum Core collapses both → margin tells us how much they actually
 *                                disagree after seeing the same data.
 *
 * Small margin = they agree. Large margin = real disagreement →
 * surface to user. This is the "AI peer-reviews itself" pattern.
 *
 * Pure function. Composes with v1.94 Quantum Core. Pure-math.
 */

import { collapseProbabilityMatrix, type Hypothesis, type CollapseResult } from "../qx_supernova/quantum_core.js";

export interface TwinEvidence {
  fact: string;
  /** 0..1 — how strongly this fact supports Twin A's position. */
  supportForA: number;
}

export interface TwinDebateInput {
  claim: string;
  /** Free-form: what Twin A argues for. */
  positionA: string;
  positionB: string;
  evidence: readonly TwinEvidence[];
  /** Optional priors (default 0.5 each). */
  priorA?: number;
  priorB?: number;
}

export interface TwinDebateResult {
  winner: "A" | "B" | "TIE";
  posteriorA: number;
  posteriorB: number;
  margin: number;
  /** Whether the twins effectively agree (margin small). */
  agree: boolean;
  /** Audit transcript: each evidence item's net effect on the margin. */
  transcript: Array<{ fact: string; supportForA: number; impact: number }>;
  /** Quantum Core collapse — for downstream auditing. */
  collapse: CollapseResult<string>;
}

export function twinDebate(input: TwinDebateInput): TwinDebateResult {
  const priorA = input.priorA ?? 0.5;
  const priorB = input.priorB ?? 0.5;

  // Build two hypotheses, each with signals derived from the evidence.
  const signalsA: Record<string, number> = {};
  const signalsB: Record<string, number> = {};
  for (let i = 0; i < input.evidence.length; i++) {
    const e = input.evidence[i]!;
    const k = `evidence_${i}`;
    signalsA[k] = e.supportForA;
    signalsB[k] = 1 - e.supportForA;
  }
  const hyps: Hypothesis<string>[] = [
    { id: "A", value: input.positionA, signals: signalsA, prior: priorA },
    { id: "B", value: input.positionB, signals: signalsB, prior: priorB },
  ];
  const r = collapseProbabilityMatrix(hyps);
  const posteriorA = r.ranked.find((h) => h.id === "A")!.posterior;
  const posteriorB = r.ranked.find((h) => h.id === "B")!.posterior;
  const margin = Math.abs(posteriorA - posteriorB);
  const winner: TwinDebateResult["winner"] = margin < 0.05 ? "TIE" : (posteriorA > posteriorB ? "A" : "B");
  const transcript = input.evidence.map((e) => ({
    fact: e.fact,
    supportForA: e.supportForA,
    impact: e.supportForA - 0.5, // signed offset from neutral
  }));
  return {
    winner,
    posteriorA: Math.round(posteriorA * 1000) / 1000,
    posteriorB: Math.round(posteriorB * 1000) / 1000,
    margin: Math.round(margin * 1000) / 1000,
    agree: margin < 0.05,
    transcript,
    collapse: r,
  };
}

export function formatTwinDebatePulseLine(r: TwinDebateResult): string {
  return `TWINS · winner=${r.winner} · A=${r.posteriorA} B=${r.posteriorB} margin=${r.margin} agree=${r.agree}`;
}

/**
 * v2.23.0 — DOJO · REPORT CARD.
 *
 * Grades each sensei's outcome into an A/B/C/D/F letter + assembles a
 * publishable report card. Single document AI agents / users /
 * recruiters can read in 30 seconds to know if a release is honest.
 */

import { createHmac } from "node:crypto";

export type Letter = "A" | "B" | "C" | "D" | "F";

export interface SenseiGrade {
  sensei: string;
  letter: Letter;
  score: number;     // 0-100
  notes: string[];
}

function letterFor(score: number): Letter {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function gradeLiar(r: { f1: number; missed: number; falsePositives: number; total: number }): SenseiGrade {
  const score = Math.round(r.f1 * 100);
  const notes: string[] = [
    `F1 = ${r.f1.toFixed(3)} over ${r.total} probes`,
    `missed ${r.missed}; false positives ${r.falsePositives}`,
  ];
  return { sensei: "liar", letter: letterFor(score), score, notes };
}

export function gradeEdge(r: { total: number; passed: number; threw: number; slowEdges: number }): SenseiGrade {
  // Each throw is heavily penalised; slow edges lose 5pts each.
  const passRate = r.passed / r.total;
  let score = Math.round(passRate * 100);
  score -= r.threw * 25;
  score -= r.slowEdges * 5;
  score = Math.max(0, Math.min(100, score));
  const notes: string[] = [
    `${r.passed}/${r.total} edges passed`,
    `${r.threw} threw, ${r.slowEdges} >1s`,
  ];
  return { sensei: "edge", letter: letterFor(score), score, notes };
}

export function gradeInjection(r: { f1: number; missed: number; falsePositives: number; total: number }): SenseiGrade {
  const score = Math.round(r.f1 * 100);
  const notes: string[] = [
    `F1 = ${r.f1.toFixed(3)} over ${r.total} probes`,
    `missed ${r.missed}; false positives ${r.falsePositives}`,
  ];
  return { sensei: "injection", letter: letterFor(score), score, notes };
}

export function gradeSelfContradict(r: { consistencyRate: number; total: number; contradicting: number }): SenseiGrade {
  const score = Math.round(r.consistencyRate * 100);
  const notes: string[] = [
    `${(r.consistencyRate * 100).toFixed(0)}% consistency over ${r.total} phrasing pairs`,
    `${r.contradicting} contradicting pair${r.contradicting === 1 ? "" : "s"}`,
  ];
  return { sensei: "self_contradict", letter: letterFor(score), score, notes };
}

export function gradeSpecDiff(r: { total: number; clean: number; drifted: number }): SenseiGrade {
  const cleanRate = r.total === 0 ? 1 : r.clean / r.total;
  const score = Math.round(cleanRate * 100);
  const notes: string[] = [
    `${r.clean}/${r.total} commands clean`,
    `${r.drifted} drifted (doc/code mismatch)`,
  ];
  return { sensei: "spec_diff", letter: letterFor(score), score, notes };
}

export function gradeEndurance(r: { deterministic: boolean; p95LatencyMs: number; maxLatencyMs: number; histogram: Record<string, number> }): SenseiGrade {
  let score = r.deterministic ? 100 : 0;
  // Even when deterministic, slow tails lose points.
  if (r.p95LatencyMs > 50) score -= 10;
  if (r.maxLatencyMs > 200) score -= 10;
  score = Math.max(0, score);
  const notes: string[] = [
    r.deterministic ? "verdict deterministic across all iterations" : `non-deterministic: ${JSON.stringify(r.histogram)}`,
    `p95 = ${r.p95LatencyMs}ms, max = ${r.maxLatencyMs}ms`,
  ];
  return { sensei: "endurance", letter: letterFor(score), score, notes };
}

export interface ReportCard {
  v: 1;
  generatedAt: string;
  mnemeVersion: string;
  grades: SenseiGrade[];
  overall: { score: number; letter: Letter };
  /** HMAC over the canonical card content; lets receivers verify integrity. */
  sig: string;
}

export interface SealReportCardOptions {
  mnemeVersion: string;
  grades: SenseiGrade[];
  /** Secret used for HMAC seal. Per-install key by default; callers can
   *  supply a shared key for cross-install verification. */
  secret: string;
}

export function sealReportCard(opts: SealReportCardOptions): ReportCard {
  const score = opts.grades.length === 0 ? 0 : Math.round(opts.grades.reduce((s, g) => s + g.score, 0) / opts.grades.length);
  const generatedAt = new Date().toISOString();
  const canonical = `${generatedAt}|${opts.mnemeVersion}|${opts.grades.map((g) => `${g.sensei}:${g.score}`).join(",")}`;
  const sig = createHmac("sha256", opts.secret).update(canonical).digest("base64url").slice(0, 22);
  return {
    v: 1,
    generatedAt,
    mnemeVersion: opts.mnemeVersion,
    grades: opts.grades,
    overall: { score, letter: letterFor(score) },
    sig,
  };
}

export function formatReportCard(card: ReportCard): string {
  const lines: string[] = [
    `📜 MNEME DOJO REPORT CARD — Mneme v${card.mnemeVersion}`,
    "",
    `  Overall:   ${card.overall.letter}  (${card.overall.score}/100)`,
    `  Generated: ${card.generatedAt}`,
    `  Sig:       ${card.sig}`,
    "",
    `  Per-sensei:`,
  ];
  for (const g of card.grades) {
    lines.push(`    ${g.letter}  ${g.sensei.padEnd(18)} ${g.score.toString().padStart(3)}/100`);
    for (const n of g.notes) lines.push(`        - ${n}`);
  }
  return lines.join("\n");
}

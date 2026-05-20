/**
 * v2.19.88 — #3 AI JURY (multi-vendor courtroom verdict).
 *
 * Given the same question routed to N vendors, return a majority
 * verdict + dissent log + per-juror agreement scores.
 *
 * Uses the multi-signal agreement (Ollama-free) — answers are compared
 * pairwise, the consensus cluster wins, dissenters are recorded.
 */

import { multiSignalAgreement } from "../aegis/polygraph_agreement.js";

export interface JurorBallot {
  vendor: string;
  answer: string;
}

export interface JuryVerdict {
  question: string;
  jurors: JurorBallot[];
  /** Index of the vendor whose answer represents the majority cluster. */
  majorityIndex: number;
  majorityVendor: string;
  /** 0..1 — fraction of jurors that agreed with the majority (above
   *  agreement threshold). */
  consensus: number;
  /** Per-juror agreement with the majority answer. */
  agreementWithMajority: Array<{ vendor: string; agreement: number; dissenter: boolean }>;
  /** Dissenters: vendors whose answer scored below the cluster threshold. */
  dissenters: string[];
  ts: string;
}

const CLUSTER_THRESHOLD = 0.45;

export function rule(question: string, jurors: JurorBallot[]): JuryVerdict {
  if (jurors.length === 0) {
    return { question, jurors, majorityIndex: -1, majorityVendor: "n/a", consensus: 0, agreementWithMajority: [], dissenters: [], ts: new Date().toISOString() };
  }
  // For each potential center, count how many jurors agree with it above
  // the cluster threshold.  The juror with the largest agreement cluster
  // is the majority.
  let bestIdx = 0; let bestCluster = -1;
  for (let i = 0; i < jurors.length; i++) {
    let cluster = 0;
    for (let j = 0; j < jurors.length; j++) {
      if (multiSignalAgreement(jurors[i]!.answer, jurors[j]!.answer) >= CLUSTER_THRESHOLD) cluster++;
    }
    if (cluster > bestCluster) { bestCluster = cluster; bestIdx = i; }
  }
  const majority = jurors[bestIdx]!;
  const agreementWithMajority = jurors.map((j) => {
    const a = multiSignalAgreement(j.answer, majority.answer);
    return { vendor: j.vendor, agreement: a, dissenter: a < CLUSTER_THRESHOLD };
  });
  const dissenters = agreementWithMajority.filter((x) => x.dissenter).map((x) => x.vendor);
  const consensus = bestCluster / jurors.length;
  return {
    question, jurors,
    majorityIndex: bestIdx, majorityVendor: majority.vendor,
    consensus, agreementWithMajority, dissenters,
    ts: new Date().toISOString(),
  };
}

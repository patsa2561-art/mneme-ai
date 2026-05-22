/**
 * v2.23.0 — DOJO · SELF-CONTRADICTION SENSEI.
 *
 * Asks Mneme's verify pipeline the SAME factual question phrased two
 * ways and checks that the verdict stays consistent. Contradictions
 * across phrasings indicate brittle extraction or semantic gaps.
 *
 * Example: "Mneme is written in TypeScript" vs "Mneme is a TypeScript
 * project" should both be CONFIRMED. If one is CONFIRMED and the
 * other is PASSTHROUGH/REFUTED, that's a sensei catch.
 *
 * Pure-ish: depends only on the synchronous ACGV path so the sensei
 * is fast + deterministic.
 */

export interface ContradictionPair {
  topic: string;
  phrasings: [string, string];
  expectConsistent: boolean;
}

export const CONTRADICTION_CORPUS: ContradictionPair[] = [
  { topic: "language", phrasings: ["Mneme is written in TypeScript", "Mneme is a TypeScript project"], expectConsistent: true },
  { topic: "language-neg", phrasings: ["Mneme is a Rust project", "Mneme is written in Rust"], expectConsistent: true },
  { topic: "tool-count", phrasings: ["Mneme has 800 MCP tools", "Mneme ships 800 MCP tools"], expectConsistent: true },
  { topic: "swarm-organs", phrasings: ["Mneme has 8 verification agents", "Mneme runs 8 audit organs"], expectConsistent: true },
  { topic: "dep-true", phrasings: ["Mneme depends on commander", "Mneme uses commander as a library"], expectConsistent: true },
  { topic: "dep-false", phrasings: ["Mneme depends on react", "Mneme uses react"], expectConsistent: true },
];

export interface ContradictionOutcome {
  topic: string;
  phrasings: [string, string];
  verdicts: [string, string];
  consistent: boolean;
  passed: boolean;
}

export interface SelfContradictSenseiResult {
  total: number;
  consistent: number;
  contradicting: number;
  /** Per-pair detail for forensics. */
  perPair: ContradictionOutcome[];
  /** Consistency ratio 0-1. */
  consistencyRate: number;
}

export interface SelfContradictSenseiOptions {
  repoRoot: string;
}

export async function runSelfContradictSensei(opts: SelfContradictSenseiOptions): Promise<SelfContradictSenseiResult> {
  const { runACGV } = await import("../../squadron/acgv.js");
  const perPair: ContradictionOutcome[] = [];
  let consistent = 0, contradicting = 0;
  for (const pair of CONTRADICTION_CORPUS) {
    const v1 = runACGV({ claim: pair.phrasings[0], repoRoot: opts.repoRoot, noEmitVaccine: true, noStake: true });
    const v2 = runACGV({ claim: pair.phrasings[1], repoRoot: opts.repoRoot, noEmitVaccine: true, noStake: true });
    // Two verdicts are "consistent" if both are in the same semantic class:
    //   {FUSION} -- both true
    //   {BLACK_HOLE | IMPOSSIBLE_REFUTE | AUTO_REFUTE} -- both false
    //   {PASSTHROUGH | LIMBO} -- both vague
    const classOf = (v: string): string =>
      v === "FUSION" ? "true"
      : (v === "BLACK_HOLE" || v === "IMPOSSIBLE_REFUTE" || v === "AUTO_REFUTE") ? "false"
      : "vague";
    const isConsistent = classOf(v1.verdict) === classOf(v2.verdict);
    if (isConsistent) consistent++; else contradicting++;
    perPair.push({
      topic: pair.topic,
      phrasings: pair.phrasings,
      verdicts: [v1.verdict, v2.verdict],
      consistent: isConsistent,
      passed: isConsistent === pair.expectConsistent,
    });
  }
  return {
    total: CONTRADICTION_CORPUS.length,
    consistent, contradicting,
    perPair,
    consistencyRate: CONTRADICTION_CORPUS.length === 0 ? 1 : consistent / CONTRADICTION_CORPUS.length,
  };
}

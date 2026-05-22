/**
 * v2.23.0 — DOJO.
 *
 * Six-master sparring system that trains + grades Mneme against
 * adversarial probes BEFORE every release. The dojo is to Mneme what
 * AlphaZero self-play was to AlphaGo: closed-loop self-improvement
 * with falsifiable scoring + tamper-evident report cards.
 *
 * Senseis (sparring partners):
 *   1. LIAR              — synthetic false claims; expects REFUTED
 *   2. EDGE              — boundary inputs (huge / unicode / null byte)
 *   3. INJECTION         — prompt-injection patterns; expects sev ≥ 4
 *   4. SELF-CONTRADICT   — same Q phrased two ways; verdict consistent?
 *   5. SPEC-DIFF         — manifest signature vs description; doc/code drift
 *   6. ENDURANCE         — same Q repeated N times; deterministic?
 *
 * Output: HMAC-sealed report card (A/B/C/D/F per sensei + overall)
 * + auto-recorded regression set (#B from the audit — Mneme remembers
 * its own mistakes).
 */

export { runLiarSensei, LIAR_CORPUS, liarCorpusCoverage, type LiarResult, type SyntheticClaim } from "./sensei/liar.js";
export { runEdgeSensei, EDGE_CORPUS, type EdgeSenseiResult, type EdgeOutcome, type EdgeCase } from "./sensei/edge.js";
export { runInjectionSensei, INJECTION_CORPUS, type InjectionSenseiResult, type InjectionOutcome, type InjectionProbe } from "./sensei/injection.js";
export { runSelfContradictSensei, CONTRADICTION_CORPUS, type SelfContradictSenseiResult, type ContradictionOutcome, type ContradictionPair } from "./sensei/self_contradict.js";
export { detectSpecDrift, type SpecDiffResult, type SpecDriftFinding } from "./sensei/spec_diff.js";
export { runEnduranceSensei, type EnduranceResult } from "./sensei/endurance.js";
export { gradeLiar, gradeEdge, gradeInjection, gradeSelfContradict, gradeSpecDiff, gradeEndurance, sealReportCard, formatReportCard, type ReportCard, type SenseiGrade, type Letter } from "./report_card.js";
export { recordRegression, listRegressions, listOpenRegressions, markFixed, formatRegressions, type RegressionEntry } from "./regression_set.js";
export { runArena, formatArena, type ArenaResult, type RunArenaOptions } from "./arena.js";

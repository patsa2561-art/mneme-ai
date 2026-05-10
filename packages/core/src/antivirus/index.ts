/**
 * Mneme Antivirus -- public surface.
 *
 * One-stop import: `import { antivirus } from "@mneme-ai/core"` then call
 * `antivirus.scan()`, `antivirus.runAllBenchmarks()`, etc.
 */

export type {
  Strain, StrainId, SuspectClaim, AssayResult, Vaccine, VaccineEfficacy,
  VaccineContext, VaccineCache, BenchmarkCase, AntivirusStats, ScanSummary,
  Pharmacopoeia, PharmacopoeiaEntry,
} from "./types.js";

export { STRAINS, listStrains, getStrain, compilePatterns } from "./strains.js";
export {
  SEED_VACCINES, vaccineById, buildCache,
  VAC_CITATIO_VIRIDIS, VAC_PERSONA_FICTUM, VAC_API_PHANTASMA,
  VAC_DEPENDS_IMAGINARIUM, VAC_TEMPUS_PERVERSUM, VAC_CONFIDENS_CARDINALIS,
  VAC_STRUCTURA_INVENITA, VAC_LOGICA_CIRCULARIS,
} from "./vaccines.js";
export type { ScanResult, ScanOptions } from "./scan.js";
export { scan, extractSuspects, draftFingerprint } from "./scan.js";
export {
  runBenchmark, runAllBenchmarks, readBenchmark, verifyEfficacySignature,
} from "./benchmark.js";
export { BENCHMARK_CASES } from "./benchmark_cases.js";
export {
  readStats, writeStats, recordScan, deriveMetrics,
} from "./stats.js";
export {
  readPharmacopoeia, writePharmacopoeia, seedPharmacopoeia,
  registerVaccine, refreshEfficacies,
} from "./pharmacopoeia.js";
export type { VaccineSignature } from "./lineage_vaccines.js";
export {
  snapshotForChromosome, mergeInheritedVaccines,
} from "./lineage_vaccines.js";
// v1.27.8 -- gap-scan: auto-evaluation of vaccine coverage using
// the user's repo as ground truth. Returns per-strain F1 + a list
// of "gap strains" with recall < 0.80 that need vaccine improvement.
export type { GapTestCase, StrainGapReport, GapScanReport } from "./gap_scan.js";
export { gapScan, buildGapCases } from "./gap_scan.js";
// v1.28.0 -- adversarial mutators (5 families: visualSwap, damerauSwap,
// phoneticDrift, crossNamespace, versionDrift) for stressing vaccines
// with the kinds of phantoms that actually appear in production AI output.
export type { MutatorName } from "./mutators.js";
export {
  visualSwap, damerauSwap, phoneticDrift, crossNamespace, versionDrift,
  bestEffortMutate,
} from "./mutators.js";
// v1.28.0 -- calibration metrics (Brier score + meanMargin) so vaccines
// are judged not only on accuracy but on how well-calibrated their
// confidence is.
export type { CalibrationCase, CalibrationReport } from "./calibration.js";
export { brierScore, meanMargin, buildCalibrationReport } from "./calibration.js";
// v1.28.0 -- auto-vaccine synthesis: feed FN samples through a
// deterministic pattern miner, get a regex back, re-evaluate against
// the gap-scan test set, accept iff recall climbs and precision holds.
export type { VaccineSynthesisResult, SynthesisInput } from "./auto_synthesize.js";
export {
  mineRegexFromSamples, evaluateCandidatePattern, synthesizeVaccine,
} from "./auto_synthesize.js";

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

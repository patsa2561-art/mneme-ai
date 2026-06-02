/**
 * @mneme-ai/xray — a signed, raw-free, deterministic X-Ray of any repo.
 *
 * Every number originates from a deterministic @mneme-ai/core analyzer
 * (git history · AST outline · npm registry metadata · regex/entropy secret
 * scan). No LLM is consulted, so the same repo at the same commit always
 * produces the same report. The report is raw-free by construction
 * (xrayLeaksRaw proves it) and sealed with an offline-verifiable Ed25519
 * NOTARY receipt, so a third party trusts the ANALYSIS, not the sender.
 */
export * from "./types.js";
export { buildXRay, type BuildOptions } from "./engine.js";
export { sealXRay, verifyXRay } from "./sign.js";
export { xrayLeaksRaw, type LeakVerdict } from "./privacy.js";
export { xrayGauntlet, type XRayGauntlet } from "./gauntlet.js";
export { isAllowedPublicUrl } from "./clone.js";
export { defaultFetcher, type MetaFetcher } from "./battery/deps.js";
export { publishReport, type PublishResult } from "./publish.js";
export { createXRayServer } from "./server.js";
export { CosmicMonitor, computeStatus, cosmicBadgeSvg, type CosmicStatus, type Sample } from "./cosmic.js";
export { runBridge } from "./bridge.js";
export { analyzeCoupling } from "./battery/coupling.js";
export { licenseClass } from "./battery/deps.js";

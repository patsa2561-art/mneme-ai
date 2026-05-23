/**
 * v2.36.0 — HONEST RECEIPT public surface.
 *
 * Every CLI invocation can emit an HMAC-signed receipt of what
 * ACTUALLY ran (install path + version + code path + latency).
 * Closes audit-card bugs #4 / #16 / #19 / #22 at once.
 */

export type {
  CodePath, InstallSnapshot, LatencyReport, HonestReceipt,
} from "./types.js";

export { snapshotInstall, safeWhich } from "./snapshot.js";

export {
  buildReceipt, verifyReceipt, appendReceipt, readLedger,
  aggregateLatency, shortHash,
} from "./receipt.js";
export type { BuildReceiptInput, LatencyStats } from "./receipt.js";

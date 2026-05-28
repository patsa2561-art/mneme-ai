/**
 * v2.78.0 — IMMUNE · Mneme's self-defense against worm-shaped behavior.
 *
 * WORM-CANARY scans text Mneme would write into AI agent-instruction files for
 * self-propagating directives. Exposed to the truth-gate (probe.immune.*) and
 * the CLI (`mneme immune selftest`).
 */
export {
  scanForWormSignatures,
  renderWormVerdict,
  KNOWN_WORM_PAYLOAD,
  type WormSignatureKind,
  type WormFinding,
  type WormScan,
} from "./worm_canary.js";

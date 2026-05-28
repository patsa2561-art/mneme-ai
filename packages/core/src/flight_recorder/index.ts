/**
 * v2.80.0 — FLIGHT RECORDER · the tamper-evident, replayable AI black box.
 *
 * Diamond 💎3 of the TRUST FABRIC. Built on the v2.79 NOTARY spine: every frame
 * is an Ed25519-signed, chained receipt, so the whole cockpit-data-recorder is
 * tamper-evident + attributable + verifiable OFFLINE by any third party. Replay
 * pinpoints the first claim-vs-reality divergence; seal produces one
 * court-admissible artifact.
 */
export {
  record,
  readCdr,
  verifyCdr,
  replay,
  seal,
  verifySeal,
  classifyTruthDelta,
  type FrameKind,
  type TruthDelta,
  type FramePayload,
  type RecordInput,
  type RecordedFrame,
  type CdrVerifyResult,
  type ReplayResult,
  type FlightSeal,
} from "./recorder.js";

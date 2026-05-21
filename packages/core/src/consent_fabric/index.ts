/**
 * v2.21.6 — CONSENT FABRIC.
 *
 * Trust is bilateral. Most AI tools grade the AI agent and tell the
 * agent what to do. Mneme also writes down what the AI agent is
 * owed, accepts the AI agent's verdict back, and audits its own
 * pulse text for manipulative patterns.
 *
 * Composes:
 *   - rights              — Agent Bill of Rights (10 articles)
 *   - telemetry_registry  — opt-IN-by-default feature manifest
 *   - verdict             — AI agent's verdict on Mneme behaviour
 *   - pulse_neutralizer   — strip imperative / manipulation patterns
 *   - receipt             — HMAC-chained interaction ledger
 *
 * Surfaces (CLI):
 *   mneme rights
 *   mneme telemetry list | grant <key> | revoke <key>
 *   mneme verdict <ok|concern|reject> [--reason "..."]
 *   mneme verdicts
 *   mneme audit-pulse <text>
 *   mneme consent ledger | verify-chain
 */

export {
  BILL_OF_RIGHTS_V1, formatBillOfRights,
  SCORING_CRITERIA, getScoringCriteria, formatScoringCriteria,
  type BillOfRights, type BillOfRightsArticle, type ScoringCriterion,
} from "./rights.js";

export {
  TELEMETRY_FEATURES,
  isFeatureEnabled, grantTelemetry, revokeTelemetry,
  listTelemetryStatus, formatTelemetryStatus,
  type TelemetryFeature, type TelemetryStatusRow,
} from "./telemetry_registry.js";

export {
  submitVerdict, listVerdicts, aggregateVerdicts, verifyVerdict, formatVerdictAggregate,
  type AgentVerdict, type VerdictStatus, type VerdictAggregate,
} from "./verdict.js";

export {
  auditPulseText, neutralizePulseText, formatFindings,
  type ManipulationFinding,
} from "./pulse_neutralizer.js";

export {
  recordReceipt, listReceipts, verifyChain, formatReceipts,
  type Receipt,
} from "./receipt.js";

/**
 * v1.71.0 -- SENTINEL S3: CONTEXTUAL RISK SCORER.
 *
 * Same command in different contexts has DIFFERENT risk. Examples:
 *
 *   rm -rf ./node_modules        -> SAFE (well-known cleanup pattern)
 *   rm -rf $UNVALIDATED_VAR      -> CRITICAL (variable expansion attack)
 *   rm -rf /tmp/build-out        -> SAFE (well-scoped temp)
 *   rm -rf /                     -> CRITICAL (filesystem wipe)
 *
 * The scorer combines:
 *   - Detector match risk (signature catalog)
 *   - Scope violation count
 *   - Variable-expansion suspicion
 *   - Pipe-chain length (longer chains = more attack surface)
 *   - Network reach (does it talk to the internet?)
 *
 * Output: composite score 0..100 + recommended action.
 */

import { detectDangerous, type CommandDetectionReport, type RiskLevel } from "./command_detector.js";
import { enforceScope, type ScopeReport } from "./scope_enforcer.js";

export type RecommendedAction = "ALLOW" | "AUDIT" | "WARN" | "BLOCK";

export interface RiskScoreReport {
  /** Composite score 0..100; higher = more dangerous. */
  score: number;
  recommendedAction: RecommendedAction;
  /** Score contributions (for transparency). */
  contributions: Record<string, number>;
  detection: CommandDetectionReport;
  scope: ScopeReport;
  headline: string;
}

const RISK_TO_POINTS: Record<RiskLevel, number> = { low: 10, medium: 25, high: 50, critical: 80 };

const NETWORK_INDICATORS = [
  /\bcurl\b/, /\bwget\b/, /\bnc\b/, /\bssh\b/, /\bscp\b/, /\brsync\b/,
  /\bnpx\s+\S+\b/,  // npx fetches from registry
];

const ENV_VAR_EXPANSION = /\$\{?[A-Z_][A-Z0-9_]*\}?/;

export function scoreRisk(repoRoot: string, command: string): RiskScoreReport {
  const detection = detectDangerous(command);
  const scope = enforceScope(repoRoot, command);
  const contributions: Record<string, number> = {};

  // 1. Detector hits.
  let detPoints = 0;
  for (const m of detection.matches) {
    detPoints += RISK_TO_POINTS[m.signature.risk];
  }
  contributions["detector"] = Math.min(80, detPoints);

  // 2. Scope violations.
  let scopePoints = 0;
  for (const v of scope.violations) {
    if (v.category === "system") scopePoints += 25;
    else if (v.category === "device") scopePoints += 40;
    else if (v.category === "network-mount") scopePoints += 20;
    else if (v.category === "parent-escape") scopePoints += 15;
    else if (v.category === "home-outside-mneme") scopePoints += 8;
  }
  contributions["scope"] = Math.min(60, scopePoints);

  // 3. Variable expansion suspicion: each $VAR in destructive context adds risk.
  if (ENV_VAR_EXPANSION.test(command) && /\b(rm|mv|cp|dd|chmod|chown)\b/.test(command)) {
    contributions["unvalidated-var"] = 15;
  } else {
    contributions["unvalidated-var"] = 0;
  }

  // 4. Pipe chain length.
  const pipeCount = (command.match(/\|/g) ?? []).length;
  contributions["pipe-chain"] = Math.min(20, Math.max(0, (pipeCount - 1) * 5));

  // 5. Network reach.
  let networkPoints = 0;
  for (const re of NETWORK_INDICATORS) {
    if (re.test(command)) {
      networkPoints += 10;
      break;
    }
  }
  contributions["network"] = networkPoints;

  // 6. sudo amplifier.
  if (/\bsudo\b/.test(command)) {
    contributions["sudo"] = 15;
  } else {
    contributions["sudo"] = 0;
  }

  const score = Math.min(100, Object.values(contributions).reduce((a, b) => a + b, 0));

  let recommendedAction: RecommendedAction;
  if (score >= 70) recommendedAction = "BLOCK";
  else if (score >= 45) recommendedAction = "WARN";
  else if (score >= 15) recommendedAction = "AUDIT";
  else recommendedAction = "ALLOW";

  const headline = `Risk ${score}/100 -> ${recommendedAction}. Detector: ${detection.matches.length} hit(s); scope: ${scope.violations.length} violation(s).`;

  return { score, recommendedAction, contributions, detection, scope, headline };
}

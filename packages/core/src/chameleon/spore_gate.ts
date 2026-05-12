/**
 * v1.86.0 -- CHAMELEON: spore safety gate.
 *
 * User's concern: spore previously auto-enabled the moment a git origin
 * was detected. Risky combinations (fork-only access, CODEOWNERS gate,
 * CI/CD on push) could lead to:
 *   - Failed pushes that confuse the user
 *   - Surprise PR-review flow
 *   - Unintended CI minutes burned on the mneme-lineage branch
 *   - Worse: pushing private lineage to a repo the user doesn't own
 *
 * v1.86 introduces an EXPLICIT OPT-IN file gate. Without it, every
 * spore push returns a structured refusal explaining why + how to
 * opt in. Once `.mneme/spore/OPT_IN` exists, spore behaves as before.
 *
 * Default behavior shifts from default-on to default-off. Existing
 * users who already configured spore can opt in with one CLI command.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { probeEnvironment, readSporeOptIn, type EnvProbe } from "./env_probe.js";

export interface SporeGateDecision {
  allow: boolean;
  reason: string;
  env: EnvProbe;
  optInState: { optedIn: boolean; reason: string };
  /** When allow=false, plain-English instruction to enable. */
  howToOptIn?: string;
}

export function sporeGate(repoRoot: string): SporeGateDecision {
  const env = probeEnvironment(repoRoot);
  const optInState = readSporeOptIn(repoRoot);
  if (!env.hasGit) {
    return {
      allow: false,
      reason: "git is not installed -- spore cannot push",
      env,
      optInState,
      howToOptIn: "install git, then run `mneme spore opt-in`",
    };
  }
  if (!env.hasOrigin) {
    return {
      allow: false,
      reason: "no origin remote configured -- nothing to push to",
      env,
      optInState,
      howToOptIn: "configure a git remote, then run `mneme spore opt-in`",
    };
  }
  if (!optInState.optedIn) {
    return {
      allow: false,
      reason: `spore push refused: ${optInState.reason}. Default is OPT-OUT after v1.86.`,
      env,
      optInState,
      howToOptIn:
        env.riskReasons.length > 0
          ? `WARNING -- this repo has push risks: ${env.riskReasons.join("; ")}. ` +
            `If you still want to proceed, run \`mneme spore opt-in --remote <private-bare-or-personal-repo>\` to acknowledge.`
          : "run `mneme spore opt-in` once to acknowledge spore can push to your remote",
    };
  }
  return {
    allow: true,
    reason: optInState.reason,
    env,
    optInState,
  };
}

/** Write the OPT_IN marker. Caller (CLI) is responsible for showing
 *  the env risk summary to the user BEFORE calling this. */
export function writeSporeOptIn(repoRoot: string, ack: string): { ok: boolean; path: string } {
  const path = join(repoRoot, ".mneme/spore/OPT_IN");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = `${new Date().toISOString()}\n${ack}\n`;
  writeFileSync(path, body, "utf8");
  return { ok: true, path };
}

/** Revoke the opt-in marker. Future spore pushes will be refused. */
export function revokeSporeOptIn(repoRoot: string): { revoked: boolean } {
  const path = join(repoRoot, ".mneme/spore/OPT_IN");
  if (!existsSync(path)) return { revoked: false };
  try {
    rmSync(path, { force: true });
    return { revoked: true };
  } catch {
    return { revoked: false };
  }
}

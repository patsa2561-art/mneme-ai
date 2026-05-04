/**
 * Deterministic / no-LLM mode — the unified gate for every command that
 * would otherwise call an LLM (heal, genius, teach) or pull a remote
 * embedder (index --embedder ollama/openai).
 *
 * Resolved from three layers, in order of precedence:
 *
 *   1. Per-invocation CLI flag       --no-llm
 *   2. Per-repo config               .mneme/config.json: { "deterministic": true }
 *   3. Per-machine env               MNEME_NO_LLM=1
 *
 * The intent: a security/compliance reviewer should be able to enforce
 * deterministic mode at any of these layers and trust that *every* command
 * respects it.
 */

import type { MnemeConfig } from "./config.js";

export function isNoLlm(cliFlag: boolean | undefined, cfg: Pick<MnemeConfig, "deterministic">): boolean {
  if (cliFlag === true) return true;
  if (cfg.deterministic === true) return true;
  const env = process.env.MNEME_NO_LLM;
  if (env === "1" || env?.toLowerCase() === "true") return true;
  return false;
}

/**
 * Standardized refusal message — same wording across heal/genius/teach so
 * users (and audit logs) recognize the pattern. Returns the exit code (2)
 * so callers can: `return refuseLlm("heal", suggestion);`
 */
export function refuseLlm(
  command: string,
  suggestion: string,
  ui: { error: (msg: string) => void; dim: (msg: string) => void },
): number {
  ui.error(`Deterministic mode (--no-llm / MNEME_NO_LLM / config.deterministic) is active.`);
  ui.dim(`'${command}' requires an LLM and will not run.`);
  ui.dim(`Try instead: ${suggestion}`);
  ui.dim(`See docs/SECURITY.md for the full deterministic-mode contract.`);
  return 2;
}

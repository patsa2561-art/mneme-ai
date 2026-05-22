/**
 * v2.24.0 — Deferred MCP runtime (closes audit findings M1 + git-repo crash).
 *
 * Pre-v2.24 boot sequence:
 *   startMcpServer →
 *     await buildRuntime(cwd)      ← throws if not git repo; takes ~10s cold
 *     await lots of lineage work
 *     server.connect(transport)    ← only NOW does the SDK answer initialize
 *
 * Consequence: spec-compliant clients (8s initialize timeout) saw "no
 * response" and disconnected. Non-git-repo clients saw exit 1 with no
 * JSON-RPC frame at all.
 *
 * Post-v2.24 boot sequence:
 *   startMcpServer →
 *     construct Server + register handlers      (sync, <50ms)
 *     server.connect(transport)                 ← initialize replies in ~50ms
 *     setImmediate(() => warm runtime in BG)    ← heavy work after handshake
 *
 * Tool calls await the deferred runtime via `getRuntime()`. If the
 * runtime cannot be built (no git repo, no DB write access, etc.) we
 * return a DEGRADED handle that lets stateless tools work and refuses
 * stateful tools with a clear error.
 */

import type { ToolRuntime } from "../tools/_types.js";
import { log } from "./structured_log.js";

export interface DegradedRuntime {
  degraded: true;
  reason: string;
  detail?: string;
  cwd: string;
}

export type DeferredRuntime = ToolRuntime | DegradedRuntime;

export function isDegraded(rt: DeferredRuntime): rt is DegradedRuntime {
  return (rt as DegradedRuntime).degraded === true;
}

/**
 * Build runtime or return a structured degraded handle. Never throws.
 */
export async function buildRuntimeOrDegrade(cwd: string): Promise<DeferredRuntime> {
  const t0 = Date.now();
  try {
    const { buildRuntime } = await import("../tools/_runtime.js");
    const rt = await buildRuntime(cwd);
    log("info", "runtime.built", { dt_ms: Date.now() - t0, cwd });
    return rt;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    log("warn", "runtime.degraded", { dt_ms: Date.now() - t0, cwd, reason: msg });
    return {
      degraded: true,
      reason: classifyRuntimeFailure(msg),
      detail: msg,
      cwd,
    };
  }
}

function classifyRuntimeFailure(msg: string): string {
  if (/not in a git repo/i.test(msg)) return "no-git-repo";
  if (/EACCES|permission denied/i.test(msg)) return "no-write-access";
  if (/ENOENT/i.test(msg)) return "missing-path";
  if (/embedder/i.test(msg)) return "embedder-init-failed";
  return "runtime-build-failed";
}

/**
 * Hold the deferred runtime in a single shared promise. Multiple
 * concurrent tool calls during cold-boot share one warming. Never
 * re-throws — DegradedRuntime is the worst case, never an exception.
 */
export function makeDeferredRuntimeHolder(cwd: string): () => Promise<DeferredRuntime> {
  let promise: Promise<DeferredRuntime> | null = null;
  return () => {
    if (!promise) promise = buildRuntimeOrDegrade(cwd);
    return promise;
  };
}

/**
 * Tools that are SAFE to call without a runtime (stateless / catalog-only).
 * Any tool not in this allow-list returns isError when runtime is degraded.
 *
 * Conservative list: only tools that genuinely don't read .mneme/ or git.
 */
export const STATELESS_TOOL_NAMES: ReadonlySet<string> = new Set([
  "mneme.welcome",
  "mneme.capabilities",
  "mneme.release_notes",
  "mneme.version",
  "mneme.candor.handshake",
  "mneme.candor.spec",
  "mneme.candor.classify",
  "mneme.candor.vaccines",
  "mneme.candor.verify_peer",
  "mneme.candor.audit",
  "mneme.health",
  "mneme.version",
  "mneme.verify_self",
  "mneme.system.health",
  // The fuzzer itself must be callable in degraded mode so a non-git
  // CI runner can self-test the MCP surface.
  "mneme.fuzz.run",
  "mneme.fuzz.report",
  "mneme.fuzz.vectors",
  "mneme.fuzz.verify",        // v2.26.0 — pure HMAC verify; no runtime needed
  "mneme.codegraph.verify",   // v2.26.0 — pure HMAC chain verify
  "mneme.codegraph.warn",     // v2.26.0 — reads snapshot file directly
  // v2.26.0 — peak-gauntlet probes spawn child + need to work standalone
  "mneme.tune.run",
  "mneme.tune.report",
  "mneme.tune.findings",
  "mneme.tune.suggest_fix",
  // v2.26.0 — governance + N7 + N11 surfaces are stateless reads
  "mneme.security.honeypot_status",
  "mneme.governance.catalog_growth",
  "mneme.governance.family_count",
]);

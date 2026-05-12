/**
 * v1.80.0 -- CONDUIT PROTOCOL: the immortal demon's nervous system.
 *
 *   relay_prompt       -- web AI generates a CONDUIT RETURN block;
 *                          user pastes back to source for real exec
 *   version_gate       -- staleness detection (fresh / aging / stale /
 *                          abandoned) for pasted soul prompts
 *   uninstall_directive -- per-vendor uninstall recipe (editor / web /
 *                          userscript / bookmarklet / all)
 *   sync_status        -- cross-vendor sync state (source-newer /
 *                          destination-newer / in-sync)
 *   phantom_exec       -- web AI previews a tool's output without
 *                          actually executing (the wildest module)
 */

export * from "./relay_prompt.js";
export * from "./version_gate.js";
export * from "./uninstall_directive.js";
export * from "./sync_status.js";
export * from "./phantom_exec.js";

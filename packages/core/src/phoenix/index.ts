/**
 * v2.19.62 PHOENIX PHASE 1 — namespace re-exports.
 *
 * Three modules ship in Phase 1:
 *   - dll_extraction: per-PID DLL hostage extraction (source-level EBUSY fix)
 *   - organs: 3 priority-1 auto-bots (Custodian + Sentinel + Surgeon)
 *   - scout: passive npm registry probe (PHOENIX P4 step 1)
 *
 * Phase 2 (future): Forager, Scholar, Pulse-bot, Lighthouse, Vampire +
 * full PHOENIX Auto-Upgrade Queen (cocoon + atomic symlink swap).
 */

export * as dllExtraction from "./dll_extraction.js";
export * as organs from "./organs.js";
export * as scout from "./scout.js";

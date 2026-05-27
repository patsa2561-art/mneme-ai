/**
 * 🦠 PROTOPLASM — public surface
 *
 * The "live atom" infrastructure. Embed `withSuperQuanProbe` in any function
 * to enable continuous statistical + quantum-inspired health monitoring.
 *
 * Composes with:
 *   - LIVING LAB (v2.58) — emit findings as living lab events
 *   - SUPERNOVA self-heal (v1.30) — broken verdicts trigger restart cycles
 *   - MNEMNET federation (v2.33) — healthy bursts can crawl globally
 *   - TRUTH GATE — broken cascades raise release block
 *   - HGP — broken patterns become hallucination genome entries
 *
 * Wire example:
 *   import { withSuperQuanProbe, startOrchestrator } from "@mneme-ai/core/protoplasm";
 *
 *   const safeFn = withSuperQuanProbe("auth.lookupUser", lookupUser, DEFAULT_PROTOPLASM_CONFIG);
 *   startOrchestrator({
 *     onBroken: (v) => console.warn("broken:", v.diagnosis?.hypothesis),
 *     onCrawl:  (v) => mnemnetCrawl(v.crawl!.searchTopics),
 *   });
 */

export type {
  ProbeOutcome,
  InvocationSnapshot,
  FunctionBaseline,
  SuperQuanFinding,
  QuantumSignals,
  WisdomRootCause,
  HealAction,
  CrawlPlan,
  ProtoplasmConfig,
} from "./types.js";

export {
  withSuperQuanProbe,
  onFinding,
  snapshotRegistry,
  clearRegistry,
} from "./super_quan_probe.js";

export { buildBaseline, computeQuantumSignals, gradeOutcome, runQuantumProbe } from "./quantum_probe.js";
export { appendFinding, readLedger, verifyChain, lastHmac, canonicalJson } from "./findings_ledger.js";
export { diagnose, ledgerHealth } from "./wisdom_space.js";
export { planCrawl } from "./crawl_planner.js";
export { startOrchestrator, manualProbeReport, DEFAULT_PROTOPLASM_CONFIG } from "./orchestrator.js";
export type { OrchestratorVerdict, OrchestratorHooks } from "./orchestrator.js";

// v2.67 — IMMORTAL ATOM layer: 5-strategy fusion that makes PROTOPLASM
// survive any kill signal up to and including SIGKILL + OS reboot.
//   WAL          → state persists to disk BEFORE RAM (uncatchable-kill safe)
//   PARASITE     → atom rides on every Mneme tool call (no daemon needed)
//   GHOST CELL   → detached watchdog detects abnormal exit + queues heal
//   PHOENIX HOOK → composes with existing SUPERNOVA / nucleus_daemon
//   SEAMLESS     → zero-config auto-init; user does nothing
export { Wal } from "./wal.js";
export type { WalRow, WalOp } from "./wal.js";
export { activateParasite, getParasite, persistBaseline, loadBaseline, parasiteTick } from "./parasite.js";
export type { ParasiteContext } from "./parasite.js";
export { spawnGhostCell } from "./ghost_cell.js";
export type { GhostCellOptions } from "./ghost_cell.js";
export { seamlessBoot, isBooted, getKeyProvenance } from "./seamless_boot.js";
export { drainHealQueue, registerWithPhoenix, PROTOPLASM_REVIVABLE } from "./phoenix_hook.js";
export type { PhoenixHookContext, HealQueueEntry, RevivableSpec } from "./phoenix_hook.js";
export { autoWrapModule, autoWrapModuleProxy, autoWrapClass } from "./auto_wrap.js";
export type { AutoWrapOptions } from "./auto_wrap.js";

// v2.68.0 — extension primitives:
//   USB SOUL      → portable WAL via mount detection
//   HYDRA QUORUM  → file-lock based primary-secondary failover
//   LAN GOSSIP    → UDP multicast peer discovery + HMAC-signed gossip
//   TS AUTO-WRAP  → static scan + non-AST regex rewrite of exports
//   CRIU PICKLE   → Linux CRIU snapshot/restore (Linux-only)
export { syncTo, syncFrom, pickMount, verifyMount } from "./usb_soul.js";
export type { UsbSoulResult } from "./usb_soul.js";
export { statusHydra, tryBecomePrimary, refreshPrimary, releasePrimary, startHydraHeartbeat, HYDRA_TUNING } from "./hydra_quorum.js";
export type { HydraStatus, HydraRole } from "./hydra_quorum.js";
export { LanGossip, GOSSIP_TUNING } from "./lan_gossip.js";
export type { GossipSummary, GossipFrame, PeerRecord, GossipOptions } from "./lan_gossip.js";
export { scanSourceFile, scanDirectory, rewriteSourceFile } from "./ts_auto_wrap.js";
export type { ScanResult, ScannedExport, RewriteResult } from "./ts_auto_wrap.js";
export { probeCriu, snapshot as criuSnapshot, restore as criuRestore } from "./criu_pickle.js";
export type { CriuAvailability, CriuSnapshotResult, CriuRestoreResult } from "./criu_pickle.js";

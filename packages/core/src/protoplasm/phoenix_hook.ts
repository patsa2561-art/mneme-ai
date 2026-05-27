/**
 * 🔥 PROTOPLASM — PHOENIX HOOK
 *
 * Integration with Mneme's existing PHOENIX (v1.21+) resurrection cycle
 * and SUPERNOVA (v1.30+) escalation.
 *
 * What Mneme already has:
 *   - PHOENIX: when daemon dies, can be respawned by OS service / cron
 *   - SUPERNOVA: factorial backoff supervised cycles for self-heal
 *   - heartbeats/ directory in ~/.mneme-global for per-PID heartbeats
 *
 * What PROTOPLASM adds via this hook:
 *   - Register PROTOPLASM as a "phoenix-revivable" subsystem
 *   - Heal queue (from ghost_cell) feeds SUPERNOVA escalation
 *   - PROTOPLASM heartbeat composes into nucleus daemon heartbeat
 *
 * On a fresh Mneme install where PHOENIX/SUPERNOVA may not be configured,
 * we degrade to "advisory mode": write to heal_queue.jsonl, let any
 * supervisor that exists pick it up.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PhoenixHookContext {
  ledgerDir: string;
  daemonLedgerDir?: string;        // typically ~/.mneme-global
}

export interface HealQueueEntry {
  ts: string;
  parentPid: number;
  reason: string;
  hbAge?: number;
}

export interface RevivableSpec {
  name: string;
  description: string;
  livenessCheck: () => boolean;
  reviveCommand: string;
}

/** Drain pending heal requests from ghost_cell → SUPERNOVA escalation. */
export function drainHealQueue(ctx: PhoenixHookContext): { drained: HealQueueEntry[]; remaining: number } {
  const queuePath = join(ctx.ledgerDir, "heal_queue.jsonl");
  if (!existsSync(queuePath)) return { drained: [], remaining: 0 };
  const lines = readFileSync(queuePath, "utf8").trim().split("\n").filter(Boolean);
  const drained: HealQueueEntry[] = [];
  for (const line of lines) {
    try { drained.push(JSON.parse(line) as HealQueueEntry); } catch { /* */ }
  }
  // Clear queue after drain
  writeFileSync(queuePath, "");
  return { drained, remaining: 0 };
}

/** Register PROTOPLASM as a phoenix-revivable subsystem. */
export function registerWithPhoenix(ctx: PhoenixHookContext, spec: RevivableSpec): { registered: boolean; path: string } {
  const registryPath = join(ctx.daemonLedgerDir ?? ctx.ledgerDir, "phoenix-revivables.jsonl");
  try {
    mkdirSync(join(ctx.daemonLedgerDir ?? ctx.ledgerDir), { recursive: true });
    appendFileSync(registryPath, JSON.stringify({
      ts: new Date().toISOString(),
      name: spec.name,
      description: spec.description,
      reviveCommand: spec.reviveCommand,
    }) + "\n");
    return { registered: true, path: registryPath };
  } catch {
    return { registered: false, path: registryPath };
  }
}

/** Default PROTOPLASM revivable spec. */
export const PROTOPLASM_REVIVABLE: RevivableSpec = {
  name: "protoplasm",
  description: "Live atom infrastructure — per-function super_quan probes with HMAC-chained findings ledger",
  livenessCheck: () => existsSync(".mneme/protoplasm/heartbeat.json"),
  reviveCommand: "mneme protoplasm report",
};

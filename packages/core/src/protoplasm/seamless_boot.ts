/**
 * 🤝 PROTOPLASM — SEAMLESS BOOT
 *
 * Zero-config auto-init. User does nothing.
 *
 * Pattern: when @mneme-ai/core is imported (any CLI cmd, any MCP call,
 * any SDK call), seamlessBoot() runs once. It:
 *   1. Activates PARASITE context (loads WAL baselines)
 *   2. Writes heartbeat
 *   3. Spawns GHOST CELL (detached watchdog)
 *
 * Cost: ~5ms per first-import-per-process.
 * Benefit: PROTOPLASM is alive from the very first Mneme tool call,
 *          forever, without any user action.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { activateParasite, parasiteTick } from "./parasite.js";
import { spawnGhostCell } from "./ghost_cell.js";
import type { ProtoplasmConfig } from "./types.js";

let BOOTED = false;
let BOOT_TS: string | null = null;

/** First-run HMAC key wizard:
 *  1. env var set → use it (caller-controlled, best)
 *  2. .mneme/protoplasm/.key file exists → load it (per-repo persistent)
 *  3. neither → generate 32-byte random key + write file with 0600 + warn
 *  Returns the key + provenance for telemetry. */
function ensureHmacKey(ledgerDir: string): { key: string; provenance: "env" | "file" | "generated" } {
  const envKey = process.env.MNEME_PROTOPLASM_KEY;
  if (envKey && envKey.length >= 16) return { key: envKey, provenance: "env" };
  try {
    mkdirSync(ledgerDir, { recursive: true });
    const keyPath = join(ledgerDir, ".key");
    if (existsSync(keyPath)) {
      const k = readFileSync(keyPath, "utf8").trim();
      if (k.length >= 16) return { key: k, provenance: "file" };
    }
    const fresh = randomBytes(32).toString("hex");
    writeFileSync(keyPath, fresh, { encoding: "utf8" });
    try { chmodSync(keyPath, 0o600); } catch { /* windows ignores */ }
    return { key: fresh, provenance: "generated" };
  } catch {
    return { key: "dev-protoplasm-fallback-INSECURE", provenance: "generated" };
  }
}

const DEFAULT_LEDGER = ".mneme/protoplasm";
const { key: AUTO_KEY, provenance: KEY_PROVENANCE } = ensureHmacKey(DEFAULT_LEDGER);

const DEFAULT_BOOT_CFG: ProtoplasmConfig = {
  baselineSamplesMin: 5,
  zScoreWarn: 2,
  zScoreBroken: 3,
  ledgerDir: DEFAULT_LEDGER,
  hmacKey: AUTO_KEY,
  crawlOnHealthyEvery: 50,
};

/** Provenance of current HMAC key. Useful for telemetry / first-run UX. */
export function getKeyProvenance(): "env" | "file" | "generated" { return KEY_PROVENANCE; }

/** Idempotent. Safe to call from anywhere; runs once per process. */
export function seamlessBoot(cfg: ProtoplasmConfig = DEFAULT_BOOT_CFG): { booted: boolean; bootedAt: string; pid: number } {
  if (BOOTED) return { booted: false, bootedAt: BOOT_TS!, pid: process.pid };

  BOOTED = true;
  BOOT_TS = new Date().toISOString();

  try {
    activateParasite(cfg);
    parasiteTick(cfg);
    spawnGhostCell({ parentPid: process.pid, ledgerDir: cfg.ledgerDir, hmacKey: cfg.hmacKey });

    // Register process exit cleanup — write final heartbeat so ghost knows clean exit
    process.on("exit", () => {
      try {
        writeFileSync(cfg.ledgerDir + "/heartbeat.json", JSON.stringify({
          pid: process.pid,
          ts: new Date().toISOString(),
          cleanExit: true,
        }));
      } catch { /* */ }
    });

    // Catch uncaught + unhandled — write WAL "incident" then re-throw
    process.on("uncaughtException", (err) => {
      try {
        appendFileSync(cfg.ledgerDir + "/incidents.jsonl",
          JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, kind: "uncaughtException", message: err.message, stack: err.stack }) + "\n");
      } catch { /* */ }
      throw err;
    });
    process.on("unhandledRejection", (reason: any) => {
      try {
        appendFileSync(cfg.ledgerDir + "/incidents.jsonl",
          JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, kind: "unhandledRejection", message: String(reason?.message ?? reason) }) + "\n");
      } catch { /* */ }
    });
  } catch { /* boot must NEVER throw — degrades gracefully */ }

  return { booted: true, bootedAt: BOOT_TS, pid: process.pid };
}

/** For tests: reset boot flag. */
export function _resetBoot(): void { BOOTED = false; BOOT_TS = null; }
export function isBooted(): boolean { return BOOTED; }

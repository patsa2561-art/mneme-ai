/**
 * 👻 PROTOPLASM — GHOST CELL
 *
 * Every `mneme <cmd>` spawns a detached watchdog child that outlives
 * parent by N seconds. If parent dies cleanly (exit 0), ghost expires
 * silently. If parent dies abnormally (SIGKILL, SIGSEGV, exit != 0),
 * ghost detects + spawns heal cycle.
 *
 * "Last words of dying parent → first words of newborn child."
 *
 * Implementation:
 *   spawn(node, [ghost_script], { detached: true, stdio: 'ignore' }).unref()
 *
 * Ghost script:
 *   - Waits N seconds polling parent PID
 *   - Reads parent's last heartbeat from .mneme/protoplasm/heartbeat.json
 *   - If heartbeat is stale + parent gone → trigger heal
 *
 * Detached + unref'd means parent can exit and ghost continues.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GhostCellOptions {
  parentPid: number;
  ledgerDir: string;
  watchdogMs?: number;
  hmacKey: string;
}

const GHOST_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const { parentPid, ledgerDir, watchdogMs } = JSON.parse(process.argv[2] || "{}");
const heartbeatPath = path.join(ledgerDir, "heartbeat.json");
const ghostLogPath = path.join(ledgerDir, "ghost_log.jsonl");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function log(event, details) {
  try {
    fs.appendFileSync(ghostLogPath, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, event, parentPid, details }) + "\\n");
  } catch {}
}

log("ghost-spawned", { watchdogMs });

const deadline = Date.now() + (watchdogMs || 30000);
let parentDiedAt = null;

(async () => {
  while (Date.now() < deadline) {
    if (parentDiedAt === null && !alive(parentPid)) {
      parentDiedAt = Date.now();
      log("parent-died");
      // Check if parent left a clean shutdown marker (heartbeat ts within last 1s)
      try {
        const hb = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
        const hbAge = Date.now() - new Date(hb.ts).getTime();
        if (hbAge < 1000) {
          log("clean-exit", { hbAge });
        } else {
          log("abnormal-exit", { hbAge });
          // FUTURE: trigger heal action — for now just log
          fs.appendFileSync(path.join(ledgerDir, "heal_queue.jsonl"),
            JSON.stringify({ ts: new Date().toISOString(), parentPid, reason: "ghost-detected-abnormal-exit", hbAge }) + "\\n");
        }
      } catch (e) {
        log("heartbeat-read-error", { msg: String(e) });
      }
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  log("ghost-expired");
  process.exit(0);
})();
`;

/** Spawn a detached ghost cell that watches the current process.
 *  Returns child PID. Parent can exit immediately; ghost continues. */
export function spawnGhostCell(opts: GhostCellOptions): number | null {
  try {
    mkdirSync(opts.ledgerDir, { recursive: true });
    // Write ghost script to temp file (detached child needs accessible script)
    const scriptPath = join(opts.ledgerDir, "ghost_runner.cjs");
    writeFileSync(scriptPath, GHOST_SCRIPT, "utf8");
    // Windows quirk: detached + paths with spaces need shell wrapping;
    // POSIX works with direct exec.
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn(
          process.execPath,
          [scriptPath, JSON.stringify({ parentPid: opts.parentPid, ledgerDir: opts.ledgerDir, watchdogMs: opts.watchdogMs ?? 30000 })],
          { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: false },
        )
      : spawn(
          process.execPath,
          [scriptPath, JSON.stringify({ parentPid: opts.parentPid, ledgerDir: opts.ledgerDir, watchdogMs: opts.watchdogMs ?? 30000 })],
          { detached: true, stdio: "ignore" },
        );
    child.unref();
    return child.pid ?? null;
  } catch { return null; }
}

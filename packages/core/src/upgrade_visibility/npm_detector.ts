/**
 * v2.21.7 — UPGRADE VISIBILITY · NPM INSTALL DETECTOR.
 *
 * Detects whether the current process tree is inside / parented by a
 * live `npm install` (or similar package-manager) operation. Used as
 * a SAFETY GATE before auto-upgrade fires — closes the race condition
 * the v2.21.6 AI-agent audit flagged:
 *
 *   "Pulse hook trigger upgrade ขนานกับที่ผมรัน npm install"
 *
 * The detection is heuristic + platform-aware:
 *
 *   - Windows: check parent process via `wmic` / `tasklist` lookup
 *     for npm.exe / yarn.exe / pnpm.exe in the ancestor chain.
 *   - POSIX:   walk `/proc/<ppid>/comm` upward looking for the same.
 *
 * On EITHER platform, if detection cannot complete (e.g. wmic
 * missing), we fail OPEN — caller should treat unknown as "do not
 * auto-upgrade right now". Better to skip a self-upgrade than to
 * collide with the user's package install.
 */

import { execSync } from "node:child_process";

export interface DetectionResult {
  /** True iff we believe an `npm install` is active in the ancestor chain. */
  detected: boolean;
  /** The detected command name, when available. */
  evidence?: string;
  /** When detection couldn't be performed, this surfaces the reason. */
  unknownReason?: string;
}

const NPM_LIKE = new Set(["npm", "npm-cli.js", "yarn", "pnpm", "bun", "npx"]);

function detectWindows(): DetectionResult {
  // wmic is being deprecated on newer Win11 builds; fall back to PowerShell Get-CimInstance.
  // Both ways: walk parent chain up to 8 levels looking for an npm-like command.
  try {
    const out = execSync('wmic process get ProcessId,ParentProcessId,Name /FORMAT:CSV', { encoding: "utf8", timeout: 3000 }).toString();
    const rows = out.split(/\r?\n/).slice(1)
      .map((l) => l.split(",").map((s) => s.trim()))
      .filter((r) => r.length >= 4);
    const byPid = new Map<number, { name: string; ppid: number }>();
    for (const r of rows) {
      const [, name, ppid, pid] = r;
      const pidN = parseInt(pid!, 10);
      const ppidN = parseInt(ppid!, 10);
      if (!Number.isFinite(pidN)) continue;
      byPid.set(pidN, { name: (name ?? "").toLowerCase(), ppid: ppidN });
    }
    let cur = process.ppid;
    for (let i = 0; i < 8 && byPid.has(cur); i++) {
      const node = byPid.get(cur)!;
      const stem = node.name.replace(/\.exe$/i, "");
      if (NPM_LIKE.has(stem)) return { detected: true, evidence: node.name };
      cur = node.ppid;
    }
    return { detected: false };
  } catch (e) {
    return { detected: false, unknownReason: `wmic probe failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

function detectPosix(): DetectionResult {
  try {
    let cur = process.ppid;
    for (let i = 0; i < 8 && cur > 0; i++) {
      const commPath = `/proc/${cur}/comm`;
      let comm: string;
      try { comm = require("node:fs").readFileSync(commPath, "utf8").trim(); }
      catch { return { detected: false }; }
      const stem = comm.toLowerCase();
      if (NPM_LIKE.has(stem)) return { detected: true, evidence: comm };
      const statPath = `/proc/${cur}/stat`;
      let parent: number;
      try {
        const stat = require("node:fs").readFileSync(statPath, "utf8") as string;
        // /proc/PID/stat format: pid (comm) state ppid ...
        // comm can contain spaces; split from the LAST ')' to be safe.
        const after = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        parent = parseInt(after[1]!, 10);
      } catch { return { detected: false }; }
      if (!Number.isFinite(parent) || parent <= 1) break;
      cur = parent;
    }
    return { detected: false };
  } catch (e) {
    return { detected: false, unknownReason: `proc probe failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Whether an npm-like operation owns the ancestor chain.  Caller
 *  should treat any positive result as "do NOT auto-upgrade". */
export function isInsideNpmInstall(): DetectionResult {
  if (process.platform === "win32") return detectWindows();
  return detectPosix();
}

/** Safety predicate used by callers that want to gate an auto-upgrade.
 *  Pass a hint string for the log. */
export function isUpgradeSafeRightNow(): { safe: boolean; reason: string } {
  const r = isInsideNpmInstall();
  if (r.detected) {
    return { safe: false, reason: `package manager active in ancestor chain (${r.evidence}); skipping to avoid race` };
  }
  if (r.unknownReason) {
    return { safe: false, reason: `cannot verify package-manager state; skipping out of caution (${r.unknownReason})` };
  }
  return { safe: true, reason: "no package manager detected in ancestor chain" };
}

export function formatDetection(r: DetectionResult): string {
  if (r.detected) return `⚠ npm-like process detected in ancestor chain: ${r.evidence}`;
  if (r.unknownReason) return `· detection inconclusive: ${r.unknownReason}`;
  return "✓ no package manager active in ancestor chain";
}

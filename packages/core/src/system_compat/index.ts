/**
 * v1.93.0 -- SYSTEM-COMPAT bot: probe the upgrade environment BEFORE
 * the daemon runs `mneme upgrade --force` so silent failures are
 * impossible.
 *
 * The user's instruction (verbatim):
 *   "ต้องมี bot เชคว่าใช้ได้ทุก environment ไหมนะ ทั้ง linux, windows,
 *    mac os และแต่ละ os มันก็มีเวอร์ชั่น ต้องเชคด้วย และต้องใช้ได้แบบ
 *    smooth super wisdom และไม่มีปัญหากับ node, brew ต้องเข้าใจกันหมด"
 *
 * What this module decides:
 *   1. Is Node new enough? (>= 22)
 *   2. Is the global install path writable WITHOUT sudo?
 *   3. Which package managers are available? (npm / yarn / pnpm / brew / docker)
 *   4. Which upgrade strategy will succeed on THIS machine? (global-npm /
 *      user-npm / brew / docker / manual)
 *   5. Final verdict: SAFE (proceed) / DEFER (wait, ask user) / BLOCK
 *      (refuse, would damage the system).
 *
 * The daemon calls probeUpgradeEnvironment() before spawning the upgrade.
 * On BLOCK → push a clear inbox message + skip the spawn. On DEFER →
 * push a "needs-attention" inbox + skip. On SAFE → proceed.
 *
 * Pure functions only — every probe returns synchronously. No network,
 * no LLM, no surprises.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, accessSync, constants, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform, release, arch } from "node:os";

// ============================================================
// Types
// ============================================================

export interface NodeInfo {
  version: string;
  major: number;
  ok: boolean;
  minRequired: string;
}

export interface PkgManagerInfo {
  available: boolean;
  version: string | null;
  path: string | null;
}

export interface OsInfo {
  platform: NodeJS.Platform;
  release: string;
  arch: string;
  /** Human label e.g. "Windows 11", "macOS 14", "Linux ubuntu-22.04". */
  label: string;
}

export interface GlobalInstallInfo {
  /** Resolved npm prefix (e.g. /usr/local on POSIX, %APPDATA%\npm on Windows). */
  prefix: string | null;
  /** Where global bins land. */
  binDir: string | null;
  /** Where global modules land. */
  modulesDir: string | null;
  /** True if writable WITHOUT sudo. */
  writable: boolean;
  /** True if writing would require admin/sudo. */
  needsElevation: boolean;
  /** Why writable=false, when false. */
  notWritableReason: string | null;
}

export type UpgradeStrategy =
  | "global-npm"        // npm install -g mneme-ai@latest
  | "user-npm"          // npm install --prefix $HOME/.local -g mneme-ai@latest
  | "brew"              // brew upgrade mneme-ai  (when tap exists; future)
  | "docker"            // docker pull ghcr.io/.../mneme-ai
  | "manual";           // tell the user — automation can't do it safely here

export type Verdict = "SAFE" | "DEFER" | "BLOCK";

export interface SystemCompatProbe {
  ts: number;
  os: OsInfo;
  node: NodeInfo;
  packageManagers: {
    npm: PkgManagerInfo;
    yarn: PkgManagerInfo;
    pnpm: PkgManagerInfo;
    brew: PkgManagerInfo;
    docker: PkgManagerInfo;
  };
  globalInstall: GlobalInstallInfo;
  upgradeStrategy: UpgradeStrategy;
  verdict: Verdict;
  reasons: string[];
  /** Human-readable single-line summary for the pulse / inbox. */
  pulseLine: string;
}

const MIN_NODE_MAJOR = 22;

// ============================================================
// OS info
// ============================================================

export function probeOs(): OsInfo {
  const p = platform();
  const r = release();
  const a = arch();
  let label: string;
  if (p === "win32") {
    label = r.startsWith("10.0") ? "Windows 10/11" : `Windows ${r}`;
  } else if (p === "darwin") {
    // macOS Darwin major numbers: 22 = Ventura, 23 = Sonoma, 24 = Sequoia.
    const major = parseInt(r.split(".")[0] ?? "0", 10);
    const macLabels: Record<number, string> = { 20: "macOS Big Sur", 21: "macOS Monterey", 22: "macOS Ventura", 23: "macOS Sonoma", 24: "macOS Sequoia" };
    label = macLabels[major] ?? `macOS ${r}`;
  } else if (p === "linux") {
    label = `Linux ${r}`;
  } else {
    label = `${p} ${r}`;
  }
  return { platform: p, release: r, arch: a, label };
}

// ============================================================
// Node info
// ============================================================

export function probeNode(): NodeInfo {
  const version = process.version; // e.g. "v22.7.0"
  const major = parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return {
    version,
    major,
    ok: major >= MIN_NODE_MAJOR,
    minRequired: `v${MIN_NODE_MAJOR}.0.0`,
  };
}

// ============================================================
// Package managers
// ============================================================

interface SpawnResult { stdout: string; stderr: string; status: number | null; }

/** Shared spawn helper. windowsHide:true keeps the daemon silent. */
function runCmd(cmd: string, args: readonly string[]): SpawnResult {
  let r: SpawnSyncReturns<string>;
  try {
    r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 5000, shell: platform() === "win32" });
  } catch (e) {
    return { stdout: "", stderr: (e as Error).message, status: -1 };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function whichPath(name: string): string | null {
  const cmd = platform() === "win32" ? "where" : "which";
  const r = runCmd(cmd, [name]);
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/)[0]?.trim() || null;
}

function probePm(name: string, versionFlag = "--version"): PkgManagerInfo {
  const path = whichPath(name);
  if (!path) return { available: false, version: null, path: null };
  const r = runCmd(name, [versionFlag]);
  if (r.status !== 0) return { available: false, version: null, path };
  const version = r.stdout.split(/\r?\n/)[0]?.trim() || null;
  return { available: true, version, path };
}

export function probePackageManagers(): SystemCompatProbe["packageManagers"] {
  return {
    npm: probePm("npm"),
    yarn: probePm("yarn"),
    pnpm: probePm("pnpm"),
    brew: probePm("brew"),
    docker: probePm("docker"),
  };
}

// ============================================================
// Global install permissions
// ============================================================

export function probeGlobalInstall(): GlobalInstallInfo {
  // Ask npm where global packages live. This is the canonical answer per
  // user's npm config (handles `nvm`, `volta`, custom prefix, etc.).
  const npmAvailable = whichPath("npm") !== null;
  if (!npmAvailable) {
    return { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: true, notWritableReason: "npm not on PATH" };
  }
  const r = runCmd("npm", ["config", "get", "prefix"]);
  if (r.status !== 0) {
    return { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: true, notWritableReason: "npm config get prefix failed" };
  }
  const prefix = r.stdout.trim();
  if (!prefix) {
    return { prefix: null, binDir: null, modulesDir: null, writable: false, needsElevation: true, notWritableReason: "empty npm prefix" };
  }
  const isWin = platform() === "win32";
  const binDir = isWin ? prefix : join(prefix, "bin");
  const modulesDir = isWin ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");

  // Test writability. If the dirs exist, check write access. If not, walk
  // up to the nearest existing parent and check that.
  let writable = false;
  let notWritableReason: string | null = null;
  try {
    const targetDir = existsSync(modulesDir) ? modulesDir : nearestExistingAncestor(modulesDir);
    if (targetDir) {
      accessSync(targetDir, constants.W_OK);
      writable = true;
    } else {
      notWritableReason = "no existing ancestor directory";
    }
  } catch (e) {
    notWritableReason = `not writable: ${(e as Error).message}`;
  }

  // On POSIX, /usr/local typically requires sudo. Detect that case.
  const needsElevation = !writable && (
    prefix.startsWith("/usr") ||
    prefix.startsWith("/opt") ||
    (isWin && /Program Files/i.test(prefix))
  );

  return { prefix, binDir, modulesDir, writable, needsElevation, notWritableReason };
}

function nearestExistingAncestor(p: string): string | null {
  let cur = p;
  for (let i = 0; i < 10; i++) {
    if (existsSync(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

// ============================================================
// Strategy + verdict
// ============================================================

export function decideStrategy(probe: Pick<SystemCompatProbe, "node" | "packageManagers" | "globalInstall" | "os">): { strategy: UpgradeStrategy; verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];

  if (!probe.node.ok) {
    reasons.push(`Node ${probe.node.version} is too old (need ${probe.node.minRequired}+). User must upgrade Node first.`);
    return { strategy: "manual", verdict: "BLOCK", reasons };
  }

  // Prefer global npm when the prefix is writable.
  if (probe.packageManagers.npm.available && probe.globalInstall.writable) {
    reasons.push(`npm ${probe.packageManagers.npm.version} available; global prefix ${probe.globalInstall.prefix} is writable.`);
    return { strategy: "global-npm", verdict: "SAFE", reasons };
  }

  // npm available but prefix NOT writable (typical macOS Homebrew-installed Node
  // owned by root, or Linux /usr/local without sudo).
  if (probe.packageManagers.npm.available && !probe.globalInstall.writable) {
    if (probe.globalInstall.needsElevation) {
      reasons.push(`npm global prefix ${probe.globalInstall.prefix} requires elevation. Refusing to auto-sudo. User should set a user-level prefix (npm config set prefix ~/.local) or use Docker.`);
      return { strategy: "user-npm", verdict: "DEFER", reasons };
    }
    reasons.push(`npm global prefix not writable (${probe.globalInstall.notWritableReason ?? "unknown reason"}). Falling back to user-prefix install.`);
    return { strategy: "user-npm", verdict: "SAFE", reasons };
  }

  // macOS + brew + no npm → recommend brew (when the tap ships; today it's manual)
  if (probe.os.platform === "darwin" && probe.packageManagers.brew.available && !probe.packageManagers.npm.available) {
    reasons.push("npm unavailable on this macOS. Brew is available but a Mneme tap is not yet shipped (roadmap). Falling back to Docker.");
    if (probe.packageManagers.docker.available) {
      return { strategy: "docker", verdict: "SAFE", reasons };
    }
    return { strategy: "manual", verdict: "DEFER", reasons };
  }

  // Last resort: Docker
  if (probe.packageManagers.docker.available) {
    reasons.push(`npm unavailable; Docker is available — using container strategy.`);
    return { strategy: "docker", verdict: "SAFE", reasons };
  }

  reasons.push("No supported package manager found (npm, brew, docker all missing). User must install Node ≥ 22 or Docker manually.");
  return { strategy: "manual", verdict: "BLOCK", reasons };
}

// ============================================================
// Top-level probe
// ============================================================

export function probeUpgradeEnvironment(): SystemCompatProbe {
  const os = probeOs();
  const node = probeNode();
  const packageManagers = probePackageManagers();
  const globalInstall = probeGlobalInstall();
  const { strategy, verdict, reasons } = decideStrategy({ os, node, packageManagers, globalInstall });
  const pulseLine = formatPulseLine({ os, node, verdict, strategy });
  return {
    ts: Date.now(),
    os,
    node,
    packageManagers,
    globalInstall,
    upgradeStrategy: strategy,
    verdict,
    reasons,
    pulseLine,
  };
}

export function formatPulseLine(args: { os: OsInfo; node: NodeInfo; verdict: Verdict; strategy: UpgradeStrategy }): string {
  const verdictMark = args.verdict === "SAFE" ? "✓" : args.verdict === "DEFER" ? "⏳" : "✗";
  return `SYSTEM-COMPAT ${verdictMark} ${args.verdict} · ${args.os.label} · Node ${args.node.version} · strategy=${args.strategy}`;
}

/** Produce the actual shell args the daemon should spawn for a given
 *  strategy. Returns null if strategy is "manual" (don't auto-execute). */
export function commandFor(strategy: UpgradeStrategy): { cmd: string; args: string[] } | null {
  switch (strategy) {
    case "global-npm":
      return { cmd: "npm", args: ["install", "-g", "mneme-ai@latest"] };
    case "user-npm":
      return { cmd: "npm", args: ["install", "--prefix", join(homedir(), ".local"), "-g", "mneme-ai@latest"] };
    case "brew":
      return { cmd: "brew", args: ["upgrade", "mneme-ai"] };
    case "docker":
      return { cmd: "docker", args: ["pull", "ghcr.io/patsa2561-art/mneme-ai:latest"] };
    case "manual":
      return null;
  }
}

/** Used by stat-based ancestry probes — kept exported so tests can verify
 *  the algorithm works on synthetic paths. */
export function _testNearestAncestor(p: string): string | null {
  return nearestExistingAncestor(p);
}

/** Used by the daemon's drainQueue when it sees mneme.system.upgrade. */
export interface DaemonGuard {
  shouldProceed: boolean;
  inboxLine?: string;
  command?: { cmd: string; args: string[] };
}

export function gateDaemonUpgrade(): DaemonGuard {
  const probe = probeUpgradeEnvironment();
  if (probe.verdict === "BLOCK") {
    return {
      shouldProceed: false,
      inboxLine: `SYSTEM-COMPAT BLOCKED upgrade: ${probe.reasons.join(" · ")}`,
    };
  }
  if (probe.verdict === "DEFER") {
    return {
      shouldProceed: false,
      inboxLine: `SYSTEM-COMPAT DEFERRED upgrade: ${probe.reasons.join(" · ")} — ask user how to proceed`,
    };
  }
  const cmd = commandFor(probe.upgradeStrategy);
  if (!cmd) {
    return {
      shouldProceed: false,
      inboxLine: `SYSTEM-COMPAT could not derive command for strategy=${probe.upgradeStrategy}`,
    };
  }
  return { shouldProceed: true, command: cmd };
}

/** Stat helper exported for test introspection only. */
export function _statSafe(p: string): { exists: boolean; isDir: boolean } {
  try {
    const s = statSync(p);
    return { exists: true, isDir: s.isDirectory() };
  } catch {
    return { exists: false, isDir: false };
  }
}

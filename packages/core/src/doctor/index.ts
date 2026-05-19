/**
 * v2.19.63 PHOENIX HARDENING — DOCTOR organ.
 *
 * The user found a NEW Windows-specific bug class: dual install
 * locations from multiple Node version managers (nvm4w + nvm-windows
 * + Volta + system Node). Each has its own npm prefix → its own
 * node_modules → potentially a different mneme-ai install. The user's
 * PATH order decides which `mneme.cmd` runs.
 *
 *   C:\nvm4w\nodejs\node_modules\mneme-ai\                          (active)
 *   C:\Users\X\AppData\Local\nvm\v22.22.1\node_modules\mneme-ai\    (legacy)
 *
 * preinstall reaps daemon via HEARTBEAT REGISTRY (global to ~/.mneme-
 * global/) so cross-prefix kill works. BUT the v2.19.62 PHOENIX P3
 * DLL extraction binds to ONE prefix's node_modules (via __dirname
 * walk). If user runs binary from a different prefix's shim, the
 * other prefix's daemon still holds canonical DLL.
 *
 * DOCTOR organ does PURE OBSERVATION:
 *   1. Enumerate candidate npm prefixes (env + known paths + which)
 *   2. Find every mneme-ai install on disk
 *   3. Report versions, identify conflicts, suggest remediation
 *
 * NEVER deletes / modifies — user filesystem is sacred. Provides
 * exact command for the user to clean up themselves.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";

const PROTOCOL_VERSION = 1;

export interface MnemeInstall {
  /** Where the mneme-ai package directory lives on disk. */
  packagePath: string;
  /** The npm prefix this install belongs to (parent of node_modules). */
  npmPrefix: string;
  /** Installed mneme-ai version (from package.json). */
  version: string;
  /** Path to the executable shim (mneme.cmd / mneme). null if not found. */
  binPath: string | null;
  /** Is this install the FIRST one to be resolved via current PATH? */
  onActivePath: boolean;
}

export interface DoctorReport {
  v: typeof PROTOCOL_VERSION;
  organ: "doctor";
  ts: string;
  platform: NodeJS.Platform;
  installs: MnemeInstall[];
  /** True iff > 1 distinct install discovered. */
  hasConflict: boolean;
  /** Distinct versions found (sorted). */
  versionsFound: string[];
  /** Active mneme on PATH (resolved first). */
  activeInstall: MnemeInstall | null;
  /** PATH entries scanned. */
  pathEntriesScanned: number;
  /** Prefixes scanned. */
  prefixesScanned: string[];
  /** Hints + remediation commands for the user. */
  recommendations: string[];
  durationMs: number;
}

/** Candidate npm prefix discovery. Returns absolute paths. Best-effort. */
export function discoverNpmPrefixes(): string[] {
  const set = new Set<string>();
  const isWin = platform() === "win32";
  const home = homedir();

  // 1. Environment variables
  if (process.env["NPM_CONFIG_PREFIX"]) set.add(process.env["NPM_CONFIG_PREFIX"]);
  if (process.env["npm_config_prefix"]) set.add(process.env["npm_config_prefix"]);

  // 2. Node executable parent (works for nvm-style managers)
  try { set.add(dirname(process.execPath)); } catch { /* */ }

  // 3. Platform-specific common paths
  if (isWin) {
    // npm default on Windows
    set.add(join(home, "AppData", "Roaming", "npm"));
    // Common Node Version Manager paths
    set.add("C:\\nvm4w\\nodejs");
    set.add(join(home, "AppData", "Local", "nvm"));
    set.add(join(home, "AppData", "Local", "fnm"));
    set.add(join(home, "AppData", "Local", "Volta"));
    set.add(join(home, "scoop", "apps", "nodejs", "current"));
    set.add("C:\\Program Files\\nodejs");
  } else {
    set.add("/usr/local");
    set.add("/usr");
    set.add(join(home, ".npm-global"));
    set.add(join(home, ".nvm", "versions", "node"));
    set.add(join(home, ".volta"));
    set.add(join(home, ".fnm"));
  }

  // 4. `npm config get prefix` — definitive but slow + may fail
  try {
    const r = spawnSync("npm", ["config", "get", "prefix"], {
      encoding: "utf8",
      timeout: 3000,
      shell: isWin,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout) {
      const prefix = r.stdout.trim();
      if (prefix) set.add(prefix);
    }
  } catch { /* */ }

  return Array.from(set).filter((p) => p && existsSync(p));
}

/** For a single prefix, find all mneme-ai installations under it.
 *  Handles both flat `<prefix>/node_modules/mneme-ai/` (npm default)
 *  AND nested per-version-of-Node setups like nvm's
 *  `<prefix>/v22.22.1/node_modules/mneme-ai/`. */
function findInstallsUnderPrefix(prefix: string): Array<{ packagePath: string; npmPrefix: string }> {
  const out: Array<{ packagePath: string; npmPrefix: string }> = [];
  const candidates: string[] = [];

  // Direct
  candidates.push(join(prefix, "node_modules", "mneme-ai"));

  // One-level: nvm-style versioned subdirs
  try {
    for (const entry of readdirSync(prefix)) {
      const sub = join(prefix, entry);
      try {
        if (!statSync(sub).isDirectory()) continue;
      } catch { continue; }
      candidates.push(join(sub, "node_modules", "mneme-ai"));
      // Two-level: nvm-windows wraps in nodejs/
      candidates.push(join(sub, "nodejs", "node_modules", "mneme-ai"));
    }
  } catch { /* */ }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const pkgJson = join(candidate, "package.json");
      if (!existsSync(pkgJson)) continue;
      // npmPrefix is the parent of node_modules — i.e. 2 dirs up from package dir
      const npmPrefix = resolve(candidate, "..", "..");
      out.push({ packagePath: candidate, npmPrefix });
    } catch { /* */ }
  }
  return out;
}

/** Read the installed mneme-ai version from its package.json. */
function readInstalledVersion(packagePath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Find the bin shim for an install. */
function findBinShim(npmPrefix: string): string | null {
  const isWin = platform() === "win32";
  const binCandidates = isWin
    ? [join(npmPrefix, "mneme.cmd"), join(npmPrefix, "mneme.ps1"), join(npmPrefix, "bin", "mneme.cmd")]
    : [join(npmPrefix, "bin", "mneme"), join(npmPrefix, "mneme")];
  for (const b of binCandidates) {
    if (existsSync(b)) return b;
  }
  return null;
}

/** Find the FIRST mneme.cmd/mneme on the current PATH. Returns absolute
 *  path or null. */
export function findActiveOnPath(): { binPath: string; pathEntry: string } | null {
  const isWin = platform() === "win32";
  const pathEntries = (process.env["PATH"] ?? "").split(delimiter);
  const names = isWin ? ["mneme.cmd", "mneme.ps1", "mneme.exe"] : ["mneme"];
  for (const entry of pathEntries) {
    if (!entry || !existsSync(entry)) continue;
    for (const name of names) {
      const candidate = join(entry, name);
      if (existsSync(candidate)) return { binPath: candidate, pathEntry: entry };
    }
  }
  return null;
}

/** Run one Doctor scan cycle. Pure observation; never mutates filesystem. */
export function runDoctorCycle(): DoctorReport {
  const t0 = Date.now();
  const prefixes = discoverNpmPrefixes();
  const seenPaths = new Set<string>();
  const installs: MnemeInstall[] = [];

  for (const pfx of prefixes) {
    const found = findInstallsUnderPrefix(pfx);
    for (const { packagePath, npmPrefix } of found) {
      if (seenPaths.has(packagePath)) continue;
      seenPaths.add(packagePath);
      installs.push({
        packagePath,
        npmPrefix,
        version: readInstalledVersion(packagePath),
        binPath: findBinShim(npmPrefix),
        onActivePath: false, // filled below
      });
    }
  }

  // Mark the install whose bin is on PATH as active
  const active = findActiveOnPath();
  let activeInstall: MnemeInstall | null = null;
  if (active) {
    for (const inst of installs) {
      if (inst.binPath && resolve(inst.binPath) === resolve(active.binPath)) {
        inst.onActivePath = true;
        activeInstall = inst;
        break;
      }
    }
  }

  const versionsFound = Array.from(new Set(installs.map((i) => i.version))).sort();
  const hasConflict = installs.length > 1;
  const pathEntriesScanned = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean).length;

  const recommendations: string[] = [];
  if (installs.length === 0) {
    recommendations.push("No mneme-ai installation detected. Run `npm install -g mneme-ai@latest`.");
  } else if (installs.length === 1) {
    recommendations.push(`Single install at ${installs[0]!.npmPrefix} (version ${installs[0]!.version}). Healthy.`);
  } else {
    recommendations.push(
      `CONFLICT: ${installs.length} installs detected across npm prefixes. PATH shim ambiguity may cause version drift + daemon respawn races.`,
    );
    if (activeInstall) {
      recommendations.push(
        `Active install (resolved via PATH): ${activeInstall.packagePath} (v${activeInstall.version}).`,
      );
    } else {
      recommendations.push("No mneme on current PATH — none of the discovered installs is reachable.");
    }
    for (const inst of installs) {
      if (inst === activeInstall) continue;
      const rmCmd = platform() === "win32"
        ? `Remove-Item -Recurse -Force "${inst.packagePath}"`
        : `rm -rf "${inst.packagePath}"`;
      recommendations.push(
        `To remove stale install (v${inst.version}) at ${inst.packagePath}: ${rmCmd}`,
      );
    }
    if (versionsFound.length > 1) {
      recommendations.push(
        `Versions disagree (${versionsFound.join(", ")}). Pick the newest + uninstall the rest with the commands above.`,
      );
    }
  }

  return {
    v: PROTOCOL_VERSION,
    organ: "doctor",
    ts: new Date().toISOString(),
    platform: platform(),
    installs,
    hasConflict,
    versionsFound,
    activeInstall,
    pathEntriesScanned,
    prefixesScanned: prefixes,
    recommendations,
    durationMs: Date.now() - t0,
  };
}

export { PROTOCOL_VERSION };

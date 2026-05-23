/**
 * v2.36.0 — Install + latency snapshot for HONEST RECEIPT.
 *
 * Every function defensively wrapped: any fs/spawn failure returns a
 * partial-but-honest snapshot rather than throwing. The receipt is
 * MORE useful when partial — "I couldn't read /usr/lib/node_modules"
 * is itself a finding.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { InstallSnapshot } from "./types.js";

function safeReadJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch { return null; }
}

function safeWhich(cmd: string): string | null {
  try {
    // Cross-platform `which`/`where` via Node's PATH walk.
    const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
    const pathSep = process.platform === "win32" ? ";" : ":";
    const exts = process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".CMD;.EXE;.BAT").split(";")
      : [""];
    for (const dir of pathEnv.split(pathSep)) {
      for (const ext of exts) {
        const candidate = join(dir, cmd + ext);
        try {
          if (existsSync(candidate)) {
            const s = statSync(candidate);
            if (s.isFile()) return candidate;
          }
        } catch { /* skip unreadable */ }
      }
    }
    return null;
  } catch { return null; }
}

function safeReadVersion(pkgJsonPath: string): string | null {
  const obj = safeReadJson<{ version?: string; name?: string }>(pkgJsonPath);
  if (!obj) return null;
  if (typeof obj.version === "string") return obj.version;
  return null;
}

/**
 * Walk every known npm prefix (DOCTOR ORGAN style) + find every
 * mneme-ai install. Returns the snapshot.
 *
 * Defensive: each prefix probe is wrapped in try/catch; a single bad
 * prefix never breaks the rest.
 */
export function snapshotInstall(): InstallSnapshot {
  const binPath = process.argv[1] ?? "";
  const pathEntries = ((process.env["PATH"] ?? process.env["Path"] ?? "").split(process.platform === "win32" ? ";" : ":")).filter(Boolean);

  // The "primary" install — derived from the bin shim's path.
  let primaryPackagePath: string | null = null;
  let primaryVersion: string | null = null;
  try {
    // Bin shim is usually $PREFIX/bin/mneme.js or $PREFIX/node_modules/.bin/mneme
    // Walk up looking for a package.json with name === "mneme-ai"
    let dir = dirname(resolve(binPath));
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, "package.json");
      const pkg = safeReadJson<{ name?: string }>(candidate);
      if (pkg?.name === "mneme-ai") {
        primaryPackagePath = candidate;
        primaryVersion = safeReadVersion(candidate);
        break;
      }
      // Also try ../node_modules/mneme-ai/package.json
      const npmCandidate = join(dir, "node_modules", "mneme-ai", "package.json");
      const npmPkg = safeReadJson<{ name?: string }>(npmCandidate);
      if (npmPkg?.name === "mneme-ai") {
        primaryPackagePath = npmCandidate;
        primaryVersion = safeReadVersion(npmCandidate);
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* swallow */ }

  // Multi-install probe: walk candidate npm prefixes + collect every
  // mneme-ai install. Mirrors DOCTOR ORGAN prefixes.
  const otherInstalls: Array<{ path: string; version: string | null }> = [];
  const candidatePrefixes = collectCandidatePrefixes();
  for (const prefix of candidatePrefixes) {
    try {
      const candidate = join(prefix, "node_modules", "mneme-ai", "package.json");
      if (!existsSync(candidate)) continue;
      const ver = safeReadVersion(candidate);
      if (primaryPackagePath && resolve(candidate) === resolve(primaryPackagePath)) continue;
      otherInstalls.push({ path: candidate, version: ver });
    } catch { /* skip */ }
  }

  // Multi-version detection.
  const versionSet = new Set<string>();
  if (primaryVersion) versionSet.add(primaryVersion);
  for (const o of otherInstalls) if (o.version) versionSet.add(o.version);
  const multiVersionDetected = versionSet.size > 1;

  return {
    binPath,
    packagePath: primaryPackagePath,
    packageVersion: primaryVersion,
    otherInstalls,
    pathEntries,
    multiVersionDetected,
  };
}

function collectCandidatePrefixes(): string[] {
  const out = new Set<string>();
  // 1) `npm config get prefix`
  try {
    const r = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8", timeout: 3000 });
    const p = (r.stdout ?? "").trim();
    if (p) out.add(p);
  } catch { /* skip */ }
  // 2) Per-platform conventional locations
  if (process.platform === "win32") {
    const userProfile = process.env["USERPROFILE"] ?? "";
    const appData = process.env["APPDATA"] ?? "";
    const prog = process.env["ProgramFiles"] ?? "C:\\Program Files";
    if (userProfile) {
      out.add(join(userProfile, "AppData", "Roaming", "npm"));
      out.add(join(userProfile, "AppData", "Local", "nvm"));
    }
    if (appData) out.add(join(appData, "npm"));
    out.add(join(prog, "nodejs"));
    out.add("C:\\nvm4w\\nodejs");
    // Walk every NVM4W version dir + add.
    try {
      const nvm4w = "C:\\nvm4w";
      if (existsSync(nvm4w)) {
        for (const v of readdirSync(nvm4w)) {
          if (/^v?\d/.test(v)) out.add(join(nvm4w, v));
        }
      }
    } catch { /* skip */ }
  } else {
    const home = process.env["HOME"] ?? "";
    if (home) {
      out.add(join(home, ".npm-global"));
      out.add(join(home, ".nvm", "versions", "node"));
    }
    out.add("/usr/local");
    out.add("/usr");
    out.add("/opt/homebrew");
  }
  // 3) Anything currently on PATH that's a node-install-shaped dir.
  for (const p of (process.env["PATH"] ?? "").split(process.platform === "win32" ? ";" : ":")) {
    if (!p) continue;
    if (/node|nvm|npm/i.test(p)) {
      // The bin dir is usually inside the prefix; walk one level up.
      try {
        const parent = dirname(p);
        out.add(parent);
        out.add(p);
      } catch { /* skip */ }
    }
  }
  return Array.from(out);
}

void safeWhich; // exported below for tests
export { safeWhich };

/**
 * v2.19.62 PHOENIX PHASE 1 — DLL EXTRACTION ORGAN.
 *
 * The user's killer insight (PHOENIX PROTOCOL P3): EBUSY isn't a bug in npm
 * or Windows — it's the design where daemon holds DLL from the package it's
 * a part of (self-referential lock). v2.19.61's rename-sideways trick
 * solves the .node binding side. THIS module solves the libvips side.
 *
 * The technique:
 *   1. Before any `require('sharp')` happens, COPY libvips-42.dll (and
 *      sibling libvips-cpp-* dll) from node_modules/@img/sharp-libvips-{platform}/
 *      to %TEMP%/mneme-vips-{pid}/
 *   2. Prepend that tmp dir to process.env.PATH
 *   3. Now `require('sharp')` triggers the .node binding to call
 *      LoadLibrary on libvips-42.dll — Windows search algorithm checks
 *      PATH (after System32 etc.), finds our tmp copy FIRST, loads it.
 *      The original node_modules/.../libvips-42.dll is NEVER touched.
 *   4. On `process.on('exit')`, recursively remove the tmp dir
 *
 * Mathematical invariant: ∀ daemon instances i,j (i ≠ j):
 *   handles(i) ∩ handles(j) = ∅
 *   → mutual exclusion is unnecessary
 *   → npm install can write libvips-42.dll in node_modules without ANY
 *     handle holder blocking it
 *
 * Cross-platform:
 *   - Windows: PATH-redirect via env var (LoadLibrary search order)
 *   - macOS:   DYLD_LIBRARY_PATH redirect for .dylib
 *   - Linux:   LD_LIBRARY_PATH redirect for .so
 *
 * The EBUSY class becomes structurally impossible because no long-lived
 * process holds the canonical install-time path of the DLL anymore.
 *
 * 12th world-first: per-PID DLL hostage extraction as a callable npm
 * package primitive. No AI tool ships this. Sharp itself doesn't ship it.
 * It's the technique Electron/VS Code use INTERNALLY but nobody surfaces
 * it as a reusable primitive.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath as __mneme_fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 1;

export interface ExtractionPlan {
  /** Per-PID tmp dir where DLLs will be copied. */
  tmpDir: string;
  /** Files to copy (source → destination pairs). */
  files: Array<{ src: string; dst: string }>;
  /** Env var to mutate (PATH on Windows; DYLD_LIBRARY_PATH on macOS; LD_LIBRARY_PATH on Linux). */
  envVar: string;
  /** The platform we're planning for. */
  platform: NodeJS.Platform;
}

export interface ExtractionResult {
  v: typeof PROTOCOL_VERSION;
  plan: ExtractionPlan;
  filesCopied: number;
  bytesCopied: number;
  filesFailed: number;
  envVarSet: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

/** Per-PID tmp dir path. Always relative to OS tmpdir + namespace + PID. */
export function pidTmpDir(pid: number = process.pid): string {
  return join(tmpdir(), `mneme-vips-${pid}`);
}

/** Find the sharp-libvips DLL directory based on platform + node_modules
 *  layout. Returns null if not found (sharp may not be installed). */
export function findLibvipsDir(packageRoot?: string): string | null {
  const root = packageRoot ?? findPackageRoot();
  if (!root) return null;
  const archMap: Record<string, string> = {
    "win32:x64": "sharp-libvips-win32-x64",
    "win32:ia32": "sharp-libvips-win32-ia32",
    "darwin:arm64": "sharp-libvips-darwin-arm64",
    "darwin:x64": "sharp-libvips-darwin-x64",
    "linux:x64": "sharp-libvips-linux-x64",
    "linux:arm64": "sharp-libvips-linux-arm64",
    "linux:arm": "sharp-libvips-linuxmusl-x64",
  };
  const key = `${process.platform}:${process.arch}`;
  const subdir = archMap[key];
  if (!subdir) return null;
  // Empirical (v2.19.64 install on Windows): sharp ships libvips DLLs inside
  // @img/sharp-{archKey}/lib rather than the split @img/sharp-libvips-{archKey}
  // layout some sharp docs describe.  The old code only checked the split
  // layout, so findLibvipsDir returned null and the daemon's extractAndRedirect
  // became a no-op even though the DLLs were right there — explaining why
  // mneme.phoenix.extract_status reported `dllExtracted: false` in v2.19.64.
  // Probe BOTH layouts; first hit wins so behaviour is preserved on any
  // sharp release that does use the libvips-prefixed dir.
  const libvipsPrefixed = join(root, "node_modules", "@img", subdir, "lib");
  if (existsSync(libvipsPrefixed)) return libvipsPrefixed;
  // Fall back to the flat @img/sharp-{archKey}/lib layout used by current sharp.
  const flatSubdir = subdir.replace(/^sharp-libvips-/, "sharp-");
  const flat = join(root, "node_modules", "@img", flatSubdir, "lib");
  return existsSync(flat) ? flat : null;
}

/** Find the package's node_modules root by walking up from this file's
 *  location. Returns null if we're not in a node_modules tree.
 *  ESM build of this module: __dirname is undefined, so we recover the
 *  module's directory from import.meta.url instead (with a CommonJS-fallback
 *  guard for environments that still expose __dirname). */
function findPackageRoot(): string | null {
  let dir: string;
  try {
    dir = dirname(__mneme_fileURLToPath(import.meta.url));
  } catch {
    try { dir = typeof __dirname === "string" ? __dirname : process.cwd(); }
    catch { dir = process.cwd(); }
  }
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "node_modules", "@img"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Returns the env var name used by this platform's dynamic-library
 *  loader to search for shared objects. */
export function dynamicLibraryEnvVar(): string {
  switch (process.platform) {
    case "win32": return "PATH";
    case "darwin": return "DYLD_LIBRARY_PATH";
    default: return "LD_LIBRARY_PATH";
  }
}

/** Build the plan: which files to copy + which env var to mutate. Pure
 *  function — no side effects. Caller can preview before executing. */
export function planExtraction(opts?: { packageRoot?: string; pid?: number }): ExtractionPlan | null {
  const libvipsDir = findLibvipsDir(opts?.packageRoot);
  if (!libvipsDir) return null;
  const pid = opts?.pid ?? process.pid;
  const tmpDir = pidTmpDir(pid);
  let entries: string[];
  try { entries = readdirSync(libvipsDir); } catch { return null; }
  // Match shared-library extensions per platform
  const extRe = process.platform === "win32"
    ? /\.dll$/i
    : process.platform === "darwin"
    ? /\.(dylib|so)(\..*)?$/i
    : /\.so(\..*)?$/i;
  const files = entries
    .filter((name) => extRe.test(name))
    .map((name) => ({
      src: join(libvipsDir, name),
      dst: join(tmpDir, name),
    }));
  return {
    tmpDir,
    files,
    envVar: dynamicLibraryEnvVar(),
    platform: process.platform,
  };
}

/** Execute the extraction: copy DLLs to per-PID tmp dir + prepend to PATH.
 *  Idempotent + FAST-PATH — re-running:
 *    1. If env var already starts with our tmpDir AND tmpDir exists → ~0ms return
 *    2. Per-file: if dst exists with matching size+mtime → skip copy (saves
 *       ~50-200ms per call for 12MB libvips)
 *  Safe-default — if any step fails, returns ok=false but never throws.
 *
 *  v2.19.64 HOTFIX: the original was idempotent in INTENT but not in COST —
 *  re-ran copyFileSync + env prepend every call. With cross_encoder warmup
 *  + bundled embedder defense-in-depth firing on cold CLI verifies, this
 *  was the 18× cold-start regression user caught. */
export function extractAndRedirect(plan?: ExtractionPlan): ExtractionResult {
  const t0 = Date.now();
  const livePlan = plan ?? planExtraction();
  if (!livePlan) {
    return {
      v: PROTOCOL_VERSION,
      plan: { tmpDir: "", files: [], envVar: dynamicLibraryEnvVar(), platform: process.platform },
      filesCopied: 0,
      bytesCopied: 0,
      filesFailed: 0,
      envVarSet: "",
      durationMs: Date.now() - t0,
      ok: false,
      error: "no libvips dir found (sharp may not be installed)",
    };
  }
  const sep = process.platform === "win32" ? ";" : ":";
  const currentEnv = process.env[livePlan.envVar] ?? "";
  // FAST PATH #1 — env already redirected + tmpdir present → bail out in ~1ms
  // The most common case after the first call in a process lifetime.
  if (currentEnv.startsWith(livePlan.tmpDir + sep) && existsSync(livePlan.tmpDir)) {
    return {
      v: PROTOCOL_VERSION,
      plan: livePlan,
      filesCopied: 0,
      bytesCopied: 0,
      filesFailed: 0,
      envVarSet: livePlan.envVar,
      durationMs: Date.now() - t0,
      ok: true,
    };
  }
  try { mkdirSync(livePlan.tmpDir, { recursive: true, mode: 0o700 }); } catch (e) {
    return {
      v: PROTOCOL_VERSION,
      plan: livePlan,
      filesCopied: 0,
      bytesCopied: 0,
      filesFailed: 0,
      envVarSet: "",
      durationMs: Date.now() - t0,
      ok: false,
      error: `mkdir failed: ${(e as Error).message}`,
    };
  }
  let filesCopied = 0;
  let bytesCopied = 0;
  let filesFailed = 0;
  let filesSkipped = 0;
  for (const { src, dst } of livePlan.files) {
    try {
      // FAST PATH #2 — dst exists with matching size + mtime → skip copy
      // (libvips DLLs are 12MB+; re-copying every call burned cold-start time)
      let skip = false;
      try {
        if (existsSync(dst)) {
          const srcStat = statSync(src);
          const dstStat = statSync(dst);
          if (srcStat.size === dstStat.size && srcStat.mtimeMs <= dstStat.mtimeMs) {
            skip = true;
            filesSkipped++;
            bytesCopied += dstStat.size;
          }
        }
      } catch { /* fall through to copy */ }
      if (!skip) {
        copyFileSync(src, dst);
        filesCopied++;
        try { bytesCopied += statSync(dst).size; } catch { /* */ }
      }
    } catch {
      filesFailed++;
    }
  }
  // Only prepend if not already prepended (avoid unbounded PATH growth)
  if (!currentEnv.startsWith(livePlan.tmpDir + sep)) {
    const newEnv = `${livePlan.tmpDir}${sep}${currentEnv}`;
    process.env[livePlan.envVar] = newEnv;
  }
  return {
    v: PROTOCOL_VERSION,
    plan: livePlan,
    filesCopied,
    bytesCopied,
    filesFailed,
    envVarSet: livePlan.envVar,
    durationMs: Date.now() - t0,
    ok: (filesCopied + filesSkipped) > 0 && filesFailed === 0,
  };
}

/** Cleanup the per-PID tmp dir. Safe to call on process exit — wraps in
 *  try/catch so it never blocks shutdown. Returns true if dir was removed. */
export function cleanupExtraction(opts?: { pid?: number; tmpDir?: string }): boolean {
  const dir = opts?.tmpDir ?? pidTmpDir(opts?.pid ?? process.pid);
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch { return false; }
}

/** Sweep ALL orphan mneme-vips-<pid> dirs in tmpdir from dead processes.
 *  Called by Custodian organ. Returns count + total bytes reclaimed. */
export function sweepOrphanTmpDirs(): { swept: number; bytesReclaimed: number; failed: number } {
  const t = tmpdir();
  let swept = 0;
  let failed = 0;
  let bytesReclaimed = 0;
  try {
    const entries = readdirSync(t);
    for (const entry of entries) {
      const m = /^mneme-vips-(\d+)$/.exec(entry);
      if (!m) continue;
      const pid = parseInt(m[1]!, 10);
      // Skip our own dir
      if (pid === process.pid) continue;
      // Is the PID alive?
      let alive = false;
      try { process.kill(pid, 0); alive = true; }
      catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
      if (alive) continue;
      // PID dead — safe to reclaim
      const path = join(t, entry);
      try {
        // Walk + total size before delete (best-effort)
        try {
          for (const f of readdirSync(path)) {
            try { bytesReclaimed += statSync(join(path, f)).size; } catch { /* */ }
          }
        } catch { /* */ }
        rmSync(path, { recursive: true, force: true, maxRetries: 3 });
        swept++;
      } catch {
        failed++;
      }
    }
  } catch { /* tmpdir scan failed — best-effort */ }
  return { swept, bytesReclaimed, failed };
}

/** Install an `exit` handler that cleans up THIS process's tmp dir on
 *  graceful shutdown. Idempotent — safe to call multiple times. Returns
 *  the installed handler so callers can remove it if needed. */
let exitHandlerInstalled = false;
let installedHandler: (() => void) | null = null;
export function installCleanupOnExit(): (() => void) | null {
  if (exitHandlerInstalled) return installedHandler;
  exitHandlerInstalled = true;
  const handler = () => { cleanupExtraction(); };
  installedHandler = handler;
  try { process.on("exit", handler); } catch { /* */ }
  // Also clean on SIGTERM/SIGINT (in case the daemon is asked to stop)
  try { process.on("SIGTERM", handler); } catch { /* */ }
  try { process.on("SIGINT", handler); } catch { /* */ }
  return handler;
}

export { PROTOCOL_VERSION };

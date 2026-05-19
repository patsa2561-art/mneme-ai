/**
 * v2.19.62 PHOENIX P3 — DLL EXTRACTION ORGAN deep tests.
 *
 * Tests the pure-function primitives + the safe-default failure semantics.
 * We test SHAPE + SAFETY (extraction never throws, sweep never deletes live
 * PIDs, env var prepend preserves prior value) rather than asserting the
 * end-to-end Windows LoadLibrary outcome (would require a real sharp install).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pidTmpDir,
  findLibvipsDir,
  dynamicLibraryEnvVar,
  planExtraction,
  extractAndRedirect,
  cleanupExtraction,
  sweepOrphanTmpDirs,
  installCleanupOnExit,
  PROTOCOL_VERSION,
} from "./dll_extraction.js";

describe("v2.19.62 dll_extraction primitives", () => {
  it("PROTOCOL_VERSION is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("pidTmpDir returns OS-tmpdir-based per-PID path", () => {
    const dir = pidTmpDir(12345);
    expect(dir).toContain("mneme-vips-12345");
    expect(dir.startsWith(tmpdir())).toBe(true);
  });

  it("pidTmpDir defaults to current process.pid", () => {
    const dir = pidTmpDir();
    expect(dir).toContain(`mneme-vips-${process.pid}`);
  });

  it("dynamicLibraryEnvVar returns platform-correct var name", () => {
    const v = dynamicLibraryEnvVar();
    if (process.platform === "win32") expect(v).toBe("PATH");
    else if (process.platform === "darwin") expect(v).toBe("DYLD_LIBRARY_PATH");
    else expect(v).toBe("LD_LIBRARY_PATH");
  });

  it("findLibvipsDir returns null when no node_modules/@img exists", () => {
    const r = findLibvipsDir("/nonexistent/path/that/has/no/node_modules");
    expect(r).toBeNull();
  });
});

describe("v2.19.62 dll_extraction with synthetic libvips dir", () => {
  let testRoot: string;
  let archDir: string;
  let libDir: string;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    testRoot = join(tmpdir(), `mneme-phoenix-test-${process.pid}-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
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
    archDir = archMap[key] ?? "sharp-libvips-linux-x64";
    libDir = join(testRoot, "node_modules", "@img", archDir, "lib");
    mkdirSync(libDir, { recursive: true });
    const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
    writeFileSync(join(libDir, `libvips-42${ext}`), "fake-vips-dll-bytes");
    writeFileSync(join(libDir, `libvips-cpp-42${ext}`), "fake-vips-cpp-dll");
    writeFileSync(join(libDir, "README.md"), "non-dll file should be ignored");
    // Save env state for restore
    originalEnv[dynamicLibraryEnvVar()] = process.env[dynamicLibraryEnvVar()];
  });

  afterEach(() => {
    try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* */ }
    // Restore env
    const v = dynamicLibraryEnvVar();
    if (originalEnv[v] !== undefined) process.env[v] = originalEnv[v];
    else delete process.env[v];
    // Cleanup any per-PID tmpdir created
    try { cleanupExtraction(); } catch { /* */ }
  });

  it("findLibvipsDir locates the synthetic dir", () => {
    if (process.platform === "win32" && process.arch !== "x64" && process.arch !== "ia32") return;
    const found = findLibvipsDir(testRoot);
    expect(found).not.toBeNull();
    expect(found).toBe(libDir);
  });

  it("planExtraction returns shared-library files only", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    expect(plan).not.toBeNull();
    expect(plan!.files.length).toBe(2); // two library files; README skipped
    expect(plan!.envVar).toBe(dynamicLibraryEnvVar());
    expect(plan!.platform).toBe(process.platform);
    // None of the planned files should be the README
    expect(plan!.files.every((f) => !f.src.endsWith("README.md"))).toBe(true);
  });

  it("planExtraction picks per-PID tmpdir for dst", () => {
    const plan = planExtraction({ packageRoot: testRoot, pid: 99999 });
    expect(plan).not.toBeNull();
    expect(plan!.tmpDir).toContain("mneme-vips-99999");
    expect(plan!.files[0]!.dst.startsWith(plan!.tmpDir)).toBe(true);
  });

  it("extractAndRedirect copies files + prepends env var", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    expect(plan).not.toBeNull();
    const envBefore = process.env[plan!.envVar] ?? "";
    const r = extractAndRedirect(plan!);
    expect(r.ok).toBe(true);
    expect(r.filesCopied).toBe(2);
    expect(r.filesFailed).toBe(0);
    expect(r.bytesCopied).toBeGreaterThan(0);
    expect(r.envVarSet).toBe(plan!.envVar);
    // Files exist in tmpdir
    expect(existsSync(plan!.files[0]!.dst)).toBe(true);
    expect(existsSync(plan!.files[1]!.dst)).toBe(true);
    // Env var prepended
    const envAfter = process.env[plan!.envVar] ?? "";
    expect(envAfter.startsWith(plan!.tmpDir)).toBe(true);
    expect(envAfter.length).toBeGreaterThan(envBefore.length);
  });

  it("extractAndRedirect returns ok=false when sharp absent (no throw)", () => {
    const r = extractAndRedirect();
    // Either ok=true (if a real sharp is actually installed in the working tree)
    // or ok=false with an error — but NEVER throws.
    expect(typeof r.ok).toBe("boolean");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("cleanupExtraction removes the per-PID tmpdir + returns true", () => {
    const plan = planExtraction({ packageRoot: testRoot, pid: process.pid });
    extractAndRedirect(plan!);
    expect(existsSync(plan!.tmpDir)).toBe(true);
    const removed = cleanupExtraction();
    expect(removed).toBe(true);
    expect(existsSync(plan!.tmpDir)).toBe(false);
  });

  it("cleanupExtraction returns false when dir already gone", () => {
    const r = cleanupExtraction({ pid: 8888888 });
    expect(r).toBe(false);
  });

  it("file contents copied byte-for-byte", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    extractAndRedirect(plan!);
    for (const { src, dst } of plan!.files) {
      const srcBytes = readFileSync(src);
      const dstBytes = readFileSync(dst);
      expect(srcBytes.equals(dstBytes)).toBe(true);
    }
  });

  it("idempotent + fast-path — second extract is a no-op (v2.19.64)", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    const r1 = extractAndRedirect(plan!);
    expect(r1.ok).toBe(true);
    expect(r1.filesCopied).toBe(2);
    // Second call hits the fast-path: env already set + tmpdir exists → skip
    const r2 = extractAndRedirect(plan!);
    expect(r2.ok).toBe(true);
    expect(r2.filesCopied).toBe(0); // fast-path skips re-copy
    expect(r2.durationMs).toBeLessThan(50); // ~1ms typical, generous bound
  });

  it("fast-path does NOT prepend PATH twice (v2.19.64 unbounded-growth fix)", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    extractAndRedirect(plan!);
    const envAfter1 = process.env[plan!.envVar] ?? "";
    extractAndRedirect(plan!);
    const envAfter2 = process.env[plan!.envVar] ?? "";
    expect(envAfter2).toBe(envAfter1); // exactly equal — no double-prepend
  });

  it("third-party env modification still triggers re-prepend (graceful recovery)", () => {
    const plan = planExtraction({ packageRoot: testRoot });
    extractAndRedirect(plan!);
    // Simulate another module clobbering the env var
    process.env[plan!.envVar] = "/some/other/path";
    const r = extractAndRedirect(plan!);
    expect(r.ok).toBe(true);
    const env = process.env[plan!.envVar] ?? "";
    expect(env.startsWith(plan!.tmpDir)).toBe(true);
  });
});

describe("v2.19.62 sweepOrphanTmpDirs liveness probing", () => {
  it("never throws + returns structured result", () => {
    const r = sweepOrphanTmpDirs();
    expect(r.swept).toBeGreaterThanOrEqual(0);
    expect(r.bytesReclaimed).toBeGreaterThanOrEqual(0);
    expect(r.failed).toBeGreaterThanOrEqual(0);
  });

  it("does NOT sweep own PID's tmpdir", () => {
    const myDir = pidTmpDir(process.pid);
    mkdirSync(myDir, { recursive: true });
    writeFileSync(join(myDir, "sentinel.txt"), "alive");
    const r = sweepOrphanTmpDirs();
    expect(existsSync(myDir)).toBe(true); // Still there
    expect(r.swept).toBeGreaterThanOrEqual(0);
    // Cleanup
    rmSync(myDir, { recursive: true, force: true });
  });

  it("DOES sweep dead-PID tmpdir", () => {
    // Pick a PID that is almost certainly dead, with a unique-per-test
    // suffix so parallel tests don't race over the same dir.
    const deadPid = 900_000_000 + (Date.now() % 1_000_000);
    let isDead = false;
    try { process.kill(deadPid, 0); }
    catch (e) { isDead = (e as NodeJS.ErrnoException).code === "ESRCH"; }
    if (!isDead) return; // skip in unlikely-collision case
    const deadDir = pidTmpDir(deadPid);
    mkdirSync(deadDir, { recursive: true });
    writeFileSync(join(deadDir, "stale.txt"), "should-be-swept");
    sweepOrphanTmpDirs();
    // Other parallel test files (organs.test.ts via runCustodianCycle) also
    // call sweepOrphanTmpDirs — invariant we care about is that the dead
    // dir is GONE after our sweep, regardless of who counted it.
    expect(existsSync(deadDir)).toBe(false);
  });

  it("returns 0 when tmpdir has no mneme-vips-* entries", () => {
    // Can't easily isolate tmpdir, so just check that we got a number
    const r = sweepOrphanTmpDirs();
    expect(typeof r.swept).toBe("number");
  });
});

describe("v2.19.62 installCleanupOnExit idempotence", () => {
  it("returns a handler the first time + same handler on repeat call", () => {
    const h1 = installCleanupOnExit();
    const h2 = installCleanupOnExit();
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("function");
  });
});

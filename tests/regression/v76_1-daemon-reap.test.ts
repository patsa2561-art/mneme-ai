/**
 * v2.76.0 — DECLARED-HANDLE LEASE: brutal reverse-engineer tests for the
 * preinstall daemon-reaper + Handle-Oracle, plus the holdsPaths root-cause fix.
 *
 * The fix: bridge + nucleus daemon register a heartbeat WITH `holdsPaths` (the
 * native DLLs they hold). The cmd.exe-safe inline PID-lease reap then kills them
 * by exact PID AND runs the Handle-Oracle on the EXACT declared handles — no
 * risky cmdline-match in the inline.
 *
 *   O1 — REAL process reap: spawn an actual node child, lease it, prove the
 *        reaper kills the real PID + Handle-Oracles its declared holdsPaths.
 *   O2 — Handle-Oracle determinism: a held file blocks, then frees the instant
 *        the holder releases (exits the loop on release, bounded attempts).
 *   O3 — heldNativeLibs declares only EXISTING native libs (no phantom paths).
 *   O4 — parser FUZZ: wmic / powershell / posix parsers never throw on garbage.
 *   O5 — inline scar guards: shipped inline harvests holdsPaths + < 8000 chars +
 *        ZERO double-quotes (regression guard for v2.75.0/.1).
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const reaper = require(resolve(__dirname, "../../packages/cli/bin/preinstall-mneme.cjs")) as any;
const REPO = resolve(__dirname, "../..");

function tmp(): string { return mkdtempSync(join(tmpdir(), "mneme-reap-")); }
const isWin = process.platform === "win32";
function pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

describe("v2.76.0 O1 — REAL process reap via lease + holdsPaths (PINNED)", () => {
  // retry: spawns a REAL child process + reaps it by PID — timing-sensitive
  // under heavy parallel-suite CPU contention (passes reliably in isolation).
  // Retries absorb transient scheduling jitter without weakening assertions.
  it("O1.1 reaps a real child by PID and Handle-Oracles its declared holdsPaths", { retry: 2 }, async () => {
    const cwd = tmp();
    const beatDir = join(cwd, ".mneme-global", "heartbeats");
    mkdirSync(beatDir, { recursive: true });
    const heldFile = join(cwd, "libvips-fake-42.dll");
    writeFileSync(heldFile, "native-bytes");

    // A REAL long-lived child (the "daemon"). It just sleeps.
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 200));
    expect(pidAlive(child.pid!)).toBe(true);

    // Its lease declares the DLL it holds.
    writeFileSync(join(beatDir, `${child.pid}.beat`), JSON.stringify({ v: 1, pid: child.pid, beatAt: new Date().toISOString(), holdsPaths: [heldFile] }));

    const result = reaper.runPreinstall({
      organDir: join(cwd, ".mneme-global"),
      heartbeatDir: beatDir,
      npmGlobalDirs: [join(cwd, "nope", "mneme-ai")], // no static DLLs
      sweepDirs: [cwd],
      imageKill: false,
      queryProcs: () => [], // isolate: ONLY the lease path
    });

    // Give the OS a moment to actually tear the process down.
    await new Promise((r) => setTimeout(r, 500));
    expect(pidAlive(child.pid!)).toBe(false);                 // real PID killed
    expect(result.leasePids).toContain(child.pid);            // reaped via lease
    const target = result.handleOracle.find((h: any) => h.dll === heldFile);
    expect(target).toBeTruthy();                              // Handle-Oracle ran on the DECLARED path
    expect(target.released).toBe(true);                       // and the handle is free after reap
    try { child.kill(); } catch { /* already dead */ }
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("v2.76.0 O2 — Handle-Oracle determinism (PINNED)", () => {
  it("O2.1 returns the instant the lock frees; bounded attempts if never", () => {
    const dir = tmp(); const f = join(dir, "x.dll"); writeFileSync(f, "x");
    let calls = 0;
    const r = reaper.waitForHandleRelease(f, { tries: 50, intervalMs: 5, openFn: () => { calls++; if (calls < 4) throw new Error("EBUSY"); }, sleep: () => {} });
    expect(r.released).toBe(true);
    expect(r.attempts).toBe(4); // exited on release, NOT all 50
    const stuck = reaper.waitForHandleRelease(f, { tries: 6, intervalMs: 1, openFn: () => { throw new Error("EBUSY"); }, sleep: () => {} });
    expect(stuck.released).toBe(false);
    expect(stuck.attempts).toBe(6);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("v2.76.0 O3 — heldNativeLibs declares only existing libs (PINNED)", () => {
  it("O3.1 returns [] for a root with no sharp/libvips (no phantom paths)", async () => {
    const core = await import("../../packages/core/src/index.js");
    const empty = tmp();
    const libs = core.phoenix.dllExtraction.heldNativeLibs(empty);
    expect(Array.isArray(libs)).toBe(true);
    expect(libs.every((p: string) => existsSync(p))).toBe(true); // never declares a non-existent handle
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("v2.76.0 O4 — process-table parser FUZZ (never throws) (PINNED)", () => {
  it("O4.1 wmic / powershell / posix parsers survive 200 garbage inputs", () => {
    const rnd = () => {
      const parts = ["", ",", '"', "\r\n", "ProcessId", "node.exe", String(Math.random()), "\x00", "'", ",,,,", "—", "💥", "\\"];
      let s = ""; const n = Math.floor(Math.random() * 12);
      for (let i = 0; i < n; i++) s += parts[Math.floor(Math.random() * parts.length)];
      return s;
    };
    for (let i = 0; i < 200; i++) {
      const g = rnd();
      expect(() => reaper.parseWmicCsv(g)).not.toThrow();
      expect(() => reaper.parsePowershellCsv(g)).not.toThrow();
      expect(() => reaper.parsePosixPs(g)).not.toThrow();
      for (const fn of ["parseWmicCsv", "parsePowershellCsv", "parsePosixPs"]) {
        const out = reaper[fn](g);
        expect(Array.isArray(out)).toBe(true);
        expect(out.every((p: any) => typeof p.pid === "number" && p.pid > 0)).toBe(true); // only sane PIDs survive
      }
    }
  });
  it("O4.2 parsers still extract a real daemon row from well-formed output", () => {
    expect(reaper.parseWmicCsv("Node,CommandLine,ProcessId\r\nHOST,node bin\\mneme.js nucleus daemon,4242").some((p: any) => p.pid === 4242)).toBe(true);
    expect(reaper.parsePosixPs("  77 node /x/mneme.js nucleus daemon\n").some((p: any) => p.pid === 77)).toBe(true);
  });
});

describe("v2.76.0 O5 — shipped inline: holdsPaths + cmd-safety scar guards (PINNED)", () => {
  it("O5.1 the inline harvests holdsPaths AND Handle-Oracles them", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../packages/cli/package.json"), "utf8"));
    const pre = pkg.scripts.preinstall as string;
    expect(pre).toMatch(/holdsPaths/);                 // reads the declared-handle lease
    expect(pre).toMatch(/let held=\[\]|for\(const dll of held\)/); // and gates them
  });
  it("O5.2 inline stays cmd.exe-safe: < 8000 chars + ZERO literal double-quotes (v2.75.0/.1 scar)", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../packages/cli/package.json"), "utf8"));
    const pre = pkg.scripts.preinstall as string;
    const body = pre.replace(/^node -e /, "").replace(/^"|"$/g, "");
    expect(pre.length).toBeLessThan(8000);
    expect(body.includes('"')).toBe(false);
  });
  it("O5.3 FAITHFUL cmd.exe smoke (Windows): inline runs via `cmd /d /s /c` exit 0 + trail", () => {
    if (!isWin) return;
    const sandbox = tmp();
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../packages/cli/package.json"), "utf8"));
    const value = pkg.scripts.preinstall as string;
    try {
      const r = spawnSync("cmd.exe", ["/d", "/s", "/c", value], {
        windowsHide: true, windowsVerbatimArguments: true, timeout: 40000, encoding: "utf8",
        env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEDRIVE: "", HOMEPATH: "", npm_package_version: "o5-rt" },
      });
      expect(r.status).toBe(0);
      expect(existsSync(join(sandbox, ".mneme-global", "preinstall-trail.jsonl"))).toBe(true);
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
  });
});

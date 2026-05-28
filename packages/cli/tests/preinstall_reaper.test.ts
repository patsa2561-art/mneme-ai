/**
 * v2.75.0 — preinstall reaper (HANDLE-ORACLE + PID-LEASE + CMDLINE-MATCH).
 * PINNED regression + SUPER-QUAN probe coverage.
 *
 * The reaper is the self-contained CommonJS preinstall hook
 * (bin/preinstall-mneme.cjs). It must: (a) match a Mneme DAEMON command
 * line — closing the node.exe-vs-mneme.exe gap — without false-positiving;
 * (b) parse every OS process-table format; (c) deterministically prove a
 * native DLL handle is released (Handle-Oracle) instead of blind sleeping;
 * (d) never throw / always be safe to run.
 *
 *   P1 — matchesMnemeDaemonCmdline (the node.exe fix; positive + negative)
 *   P2 — process-table parsers (wmic / powershell / posix ps)
 *   P3 — selectDaemonPids (excludes self, dedups, filters)
 *   P4 — Handle-Oracle (tryExclusiveOpen + waitForHandleRelease, injected)
 *   P5 — libvips DLL candidates + heartbeat-lease read
 *   P6 — runPreinstall smoke: never throws, returns a result, no real kills
 *   Q1 — SUPER-QUAN: wrap the hot decision fns; assert transparency + probe ran
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { withSuperQuanProbe, snapshotRegistry, clearRegistry } from "../../core/src/protoplasm/index.js";
import type { ProtoplasmConfig } from "../../core/src/protoplasm/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const reaper = require(resolve(__dirname, "../bin/preinstall-mneme.cjs")) as {
  matchesMnemeDaemonCmdline: (c: string) => boolean;
  parseWmicCsv: (s: string) => Array<{ pid: number; cmdline: string }>;
  parsePowershellCsv: (s: string) => Array<{ pid: number; cmdline: string }>;
  parsePosixPs: (s: string) => Array<{ pid: number; cmdline: string }>;
  selectDaemonPids: (procs: Array<{ pid: number; cmdline: string }>, self: number) => number[];
  libvipsDllCandidates: (dir: string, win: boolean) => string[];
  tryExclusiveOpen: (p: string, openFn?: (p: string) => void) => boolean;
  waitForHandleRelease: (p: string, opts?: { tries?: number; intervalMs?: number; openFn?: (p: string) => void; sleep?: (ms: number) => void }) => { released: boolean; attempts: number };
  readHeartbeatLeases: (dir: string) => Array<{ pid: number; holdsPaths: string[]; beatFile: string }>;
  runPreinstall: (opts?: { npmGlobalDirs?: string[] }) => unknown;
};

function tmp(): string { return mkdtempSync(join(tmpdir(), "mneme-reaper-test-")); }

/* ───────────── P1 — the node.exe-vs-mneme.exe fix ───────────── */
describe("v2.75.0 P1 — matchesMnemeDaemonCmdline (PINNED)", () => {
  it("P1.1 MATCHES a node.exe daemon (the exact case taskkill /IM mneme.exe missed)", () => {
    expect(reaper.matchesMnemeDaemonCmdline('node.exe C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\mneme-ai\\bin\\mneme.js nucleus daemon --detach')).toBe(true);
    expect(reaper.matchesMnemeDaemonCmdline('/usr/bin/node /usr/local/lib/node_modules/mneme-ai/bin/mneme.js nucleus daemon')).toBe(true);
    expect(reaper.matchesMnemeDaemonCmdline('node bin/mneme.js daemon')).toBe(true);
  });

  it("P1.2 does NOT match unrelated processes (no false positive)", () => {
    expect(reaper.matchesMnemeDaemonCmdline("node.exe server.js")).toBe(false);
    expect(reaper.matchesMnemeDaemonCmdline("code --edit mneme.ts")).toBe(false); // editor on a file named mneme
    expect(reaper.matchesMnemeDaemonCmdline("node mneme.js verify 'hi'")).toBe(false); // a one-shot CLI verb, NOT the daemon
    expect(reaper.matchesMnemeDaemonCmdline("")).toBe(false);
    // @ts-expect-error bad input
    expect(reaper.matchesMnemeDaemonCmdline(null)).toBe(false);
  });

  it("P1.3 never matches the installer itself (no self-immolation)", () => {
    expect(reaper.matchesMnemeDaemonCmdline("node bin/preinstall-mneme.cjs nucleus daemon")).toBe(false);
    expect(reaper.matchesMnemeDaemonCmdline("node bin/postinstall-mneme-lite.cjs daemon")).toBe(false);
  });
});

/* ───────────── P2 — process-table parsers ───────────── */
describe("v2.75.0 P2 — process-table parsers (PINNED)", () => {
  it("P2.1 parseWmicCsv: handles commas inside the command line", () => {
    const csv = [
      "Node,CommandLine,ProcessId",
      'DESKTOP,node.exe C:\\mneme\\bin\\mneme.js nucleus daemon --flag a,b,c,12345',
      "DESKTOP,System Idle Process,0",
    ].join("\r\n");
    const rows = reaper.parseWmicCsv(csv);
    const daemon = rows.find((r) => r.pid === 12345);
    expect(daemon).toBeTruthy();
    expect(daemon!.cmdline).toContain("mneme.js nucleus daemon");
    expect(daemon!.cmdline).toContain("a,b,c"); // commas preserved
  });

  it("P2.2 parsePowershellCsv: pid,cmdline rows", () => {
    const csv = '"ProcessId","CommandLine"\r\n"888","node.exe bin\\mneme.js nucleus daemon"\r\n"999","node.exe other.js"';
    const rows = reaper.parsePowershellCsv(csv);
    expect(rows).toEqual(expect.arrayContaining([{ pid: 888, cmdline: "node.exe bin\\mneme.js nucleus daemon" }]));
  });

  it("P2.3 parsePosixPs: `pid args` lines", () => {
    const out = "  123 node /usr/lib/node_modules/mneme-ai/bin/mneme.js nucleus daemon\n  456 /bin/bash\n";
    const rows = reaper.parsePosixPs(out);
    expect(rows.find((r) => r.pid === 123)!.cmdline).toContain("mneme.js nucleus daemon");
    expect(rows.find((r) => r.pid === 456)).toBeTruthy();
  });

  it("P2.4 parsers tolerate garbage / empty input", () => {
    expect(reaper.parseWmicCsv("")).toEqual([]);
    expect(reaper.parsePowershellCsv("not csv at all")).toEqual([]);
    expect(reaper.parsePosixPs("")).toEqual([]);
  });
});

/* ───────────── P3 — selectDaemonPids ───────────── */
describe("v2.75.0 P3 — selectDaemonPids (PINNED)", () => {
  it("P3.1 selects only daemon cmdlines, excludes self, dedups", () => {
    const procs = [
      { pid: 100, cmdline: "node bin/mneme.js nucleus daemon" },
      { pid: 100, cmdline: "node bin/mneme.js nucleus daemon" }, // dup pid
      { pid: 200, cmdline: "node server.js" },                   // not a daemon
      { pid: 300, cmdline: "node mneme.js daemon --detach" },
      { pid: 42, cmdline: "node bin/mneme.js nucleus daemon" },  // self
    ];
    expect(reaper.selectDaemonPids(procs, 42).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  it("P3.2 empty / bad input → []", () => {
    expect(reaper.selectDaemonPids([], 1)).toEqual([]);
    // @ts-expect-error bad input
    expect(reaper.selectDaemonPids(null, 1)).toEqual([]);
  });
});

/* ───────────── P4 — Handle-Oracle ───────────── */
describe("v2.75.0 P4 — Handle-Oracle deterministic gate (PINNED)", () => {
  it("P4.1 tryExclusiveOpen: open succeeds → released true; throws → false", () => {
    const ok = tmp(); const lockedFile = join(ok, "x.dll"); writeFileSync(lockedFile, "x");
    expect(reaper.tryExclusiveOpen(lockedFile, () => { /* success */ })).toBe(true);
    expect(reaper.tryExclusiveOpen(lockedFile, () => { throw new Error("EBUSY"); })).toBe(false);
    rmSync(ok, { recursive: true, force: true });
  });

  it("P4.2 absent file is treated as released (nothing to lock)", () => {
    expect(reaper.tryExclusiveOpen(join(tmpdir(), "definitely-not-there-" + Date.now() + ".dll"), () => { throw new Error("EBUSY"); })).toBe(true);
  });

  it("P4.3 waitForHandleRelease returns the instant the lock frees (deterministic, not blind sleep)", () => {
    const dir = tmp(); const f = join(dir, "libvips.dll"); writeFileSync(f, "x");
    let calls = 0;
    // Locked for the first 2 probes, then frees on the 3rd.
    const openFn = () => { calls++; if (calls < 3) throw new Error("EBUSY"); };
    let slept = 0;
    const r = reaper.waitForHandleRelease(f, { tries: 40, intervalMs: 10, openFn, sleep: () => { slept++; } });
    expect(r.released).toBe(true);
    expect(r.attempts).toBe(3);     // exited the instant it freed — NOT all 40 tries
    expect(slept).toBe(2);          // only slept between the 2 failed probes
    rmSync(dir, { recursive: true, force: true });
  });

  it("P4.4 waitForHandleRelease gives up after `tries` if never freed", () => {
    const dir = tmp(); const f = join(dir, "stuck.dll"); writeFileSync(f, "x");
    const r = reaper.waitForHandleRelease(f, { tries: 5, intervalMs: 1, openFn: () => { throw new Error("EBUSY"); }, sleep: () => {} });
    expect(r.released).toBe(false);
    expect(r.attempts).toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ───────────── P5 — DLL candidates + heartbeat-lease read ───────────── */
describe("v2.75.0 P5 — DLL candidates + heartbeat-lease (PINNED)", () => {
  it("P5.1 libvipsDllCandidates: Windows lists the libvips + sharp .node paths; POSIX is empty", () => {
    const win = reaper.libvipsDllCandidates("C:\\npm\\mneme-ai", true);
    expect(win.some((p) => p.includes("libvips-42.dll"))).toBe(true);
    expect(win.some((p) => p.includes("sharp-win32-x64.node"))).toBe(true);
    expect(reaper.libvipsDllCandidates("/usr/lib/mneme-ai", false)).toEqual([]);
  });

  it("P5.2 readHeartbeatLeases parses {pid,holdsPaths} and skips corrupt files", () => {
    const dir = tmp();
    writeFileSync(join(dir, "111.beat"), JSON.stringify({ pid: 111, beatAt: "x", holdsPaths: ["/a/libvips.dll"] }));
    writeFileSync(join(dir, "222.beat"), JSON.stringify({ pid: 222, beatAt: "y" }));
    writeFileSync(join(dir, "bad.beat"), "{ not json");
    writeFileSync(join(dir, "ignore.txt"), "nope");
    const leases = reaper.readHeartbeatLeases(dir);
    expect(leases.map((l) => l.pid).sort((a, b) => a - b)).toEqual([111, 222]);
    expect(leases.find((l) => l.pid === 111)!.holdsPaths).toEqual(["/a/libvips.dll"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ───────────── P6 — runPreinstall smoke ───────────── */
describe("v2.75.0 P6 — runPreinstall is always-safe (PINNED)", () => {
  it("P6.1 runs fully hermetic (injected dirs + no-op query/kill) without throwing + returns a result shape", () => {
    const fakeNpm = tmp();          // empty → no DLLs to touch
    const fakeOrgan = tmp();        // trail + flag go here, NOT real ~/.mneme-global
    const fakeBeats = tmp();        // no real heartbeats read/deleted
    let killed: number[] = [];
    let result: any;
    expect(() => {
      result = reaper.runPreinstall({
        npmGlobalDirs: [join(fakeNpm, "mneme-ai")],
        organDir: fakeOrgan,
        heartbeatDir: fakeBeats,
        sweepDirs: [fakeNpm],
        imageKill: false,                                   // never spawn taskkill /IM in tests
        queryProcs: () => [{ pid: 999999, cmdline: "node bin/mneme.js nucleus daemon" }],
        killFn: (pids: number[]) => { killed = killed.concat(pids); return pids.map((p) => ({ pid: p, killed: true })); },
      });
    }).not.toThrow();
    expect(result).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.handleOracle)).toBe(true);
    expect(typeof result.renamed).toBe("number");
    expect(result.cmdlinePids).toContain(999999); // cmdline-match found the injected daemon
    expect(killed).toContain(999999);             // and the reaper asked to kill it
    rmSync(fakeNpm, { recursive: true, force: true });
    rmSync(fakeOrgan, { recursive: true, force: true });
    rmSync(fakeBeats, { recursive: true, force: true });
  });
});

/* ───────────── P7 — inline preinstall is generated, safe, in-sync ───────────── */
describe("v2.75.0 P7 — shipped inline preinstall (chicken-and-egg safe + in sync) (PINNED)", () => {
  it("P7.1 package.json preinstall is inline `node -e` with NO package-internal file ref (the v2.19.48/49 scar)", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    const pre = pkg.scripts.preinstall as string;
    expect(/^node -e /.test(pre)).toBe(true);
    // The fatal anti-pattern: referencing a package file that may not exist yet.
    expect(pre).not.toMatch(/node\s+bin\//);
    expect(pre).not.toMatch(/require\(['"]\.\.?\//);
  });

  it("P7.2 the shipped inline reaps the node.exe daemon by PID + uses the Handle-Oracle", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    const pre = pkg.scripts.preinstall as string;
    expect(pre).toMatch(/heartbeats|\.beat|\/PID/);          // node.exe daemon reaped by PID (image-name kill misses it)
    expect(pre).toMatch(/handle-oracle|openSync\([^)]*r\+/); // deterministic Handle-Oracle gate
    expect(pre).toContain("preinstall-end");                 // completes the trail
  });

  it("P7.3 CMD-SAFETY GUARD: inline < 8000 chars AND zero literal double-quotes (v2.75.0=18.5KB, v2.75.1=quote-broke-cmd)", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    const pre = pkg.scripts.preinstall as string;
    const body = pre.replace(/^node -e /, "").replace(/^"|"$/g, "");
    expect(pre.length).toBeGreaterThan(200);
    expect(pre.length).toBeLessThan(8000);          // Windows cmd.exe ~8191 limit
    expect(body.includes('"')).toBe(false);          // a literal " breaks `cmd /c "node -e \"…\""` quoting
  });

  it("P7.4 FAITHFUL cmd.exe SMOKE (Windows): the inline runs through `cmd /d /s /c` exit 0 + writes the trail", async () => {
    if (process.platform !== "win32") return; // the failure mode is Windows-cmd-only
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { join: pjoin } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    const value = pkg.scripts.preinstall as string;
    const sandbox = fs.mkdtempSync(pjoin(os.tmpdir(), "mneme-cmd-smoke-"));
    try {
      // Reproduce npm's EXACT Windows invocation: cmd /d /s /c "<preinstall>", verbatim.
      const r = spawnSync("cmd.exe", ["/d", "/s", "/c", value], {
        windowsHide: true, windowsVerbatimArguments: true, timeout: 40000, encoding: "utf8",
        env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEDRIVE: "", HOMEPATH: "", npm_package_version: "smoke-rt" },
      });
      expect(r.status).toBe(0); // v2.75.0 → "command line is too long"; v2.75.1 → cmd parse error
      expect(fs.existsSync(pjoin(sandbox, ".mneme-global", "preinstall-trail.jsonl"))).toBe(true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

/* ───────────── Q1 — SUPER-QUAN probe coverage ───────────── */
describe("v2.75.0 Q1 — SUPER-QUAN probe over the reaper hot path (PINNED)", () => {
  beforeEach(() => clearRegistry());

  it("Q1.1 wrapping the decision fn with withSuperQuanProbe is TRANSPARENT (probe never alters the verdict)", () => {
    const dir = tmp();
    const cfg: ProtoplasmConfig = { baselineSamplesMin: 5, zScoreWarn: 2, zScoreBroken: 4, ledgerDir: dir, hmacKey: "test-key", crawlOnHealthyEvery: 1000 };
    const probed = withSuperQuanProbe("reaper.matchesMnemeDaemonCmdline", reaper.matchesMnemeDaemonCmdline, cfg);
    const samples = [
      "node.exe bin/mneme.js nucleus daemon --detach",
      "node server.js",
      "/usr/bin/node /usr/lib/node_modules/mneme-ai/bin/mneme.js nucleus daemon",
      "code --edit mneme.ts",
      "node bin/preinstall-mneme.cjs daemon",
    ];
    // Battery > baselineSamplesMin so the quantum baseline is built + probed.
    for (let i = 0; i < 120; i++) {
      const s = samples[i % samples.length];
      expect(probed(s)).toBe(reaper.matchesMnemeDaemonCmdline(s)); // transparency invariant
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("Q1.2 the probe registered the fn + accumulated a call buffer (instrumentation is live)", () => {
    const dir = tmp();
    const cfg: ProtoplasmConfig = { baselineSamplesMin: 5, zScoreWarn: 2, zScoreBroken: 4, ledgerDir: dir, hmacKey: "k", crawlOnHealthyEvery: 1000 };
    const probed = withSuperQuanProbe("reaper.waitForHandleRelease", reaper.waitForHandleRelease, cfg);
    const lockedFile = join(dir, "locked.dll"); writeFileSync(lockedFile, "x"); // exists → openFn is consulted
    for (let i = 0; i < 30; i++) {
      const r = probed(lockedFile, { tries: 1, openFn: () => { throw new Error("EBUSY"); }, sleep: () => {} });
      expect(r.released).toBe(false); // file exists + openFn always throws → never released
    }
    const snap = snapshotRegistry();
    const ids = Array.isArray(snap) ? snap.map((s: any) => s.fnId ?? s.id) : Object.keys(snap);
    expect(ids.some((id: string) => String(id).includes("reaper.waitForHandleRelease"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

#!/usr/bin/env node
/**
 * v2.75.0 — MNEME preinstall reaper (HANDLE-ORACLE + PID-LEASE + CMDLINE-MATCH).
 *
 * THE BUG THIS CLOSES. The old inline preinstall did `taskkill /F /IM
 * mneme.exe /T` — but the Mneme daemon on Windows runs as
 * `node.exe …\bin\mneme.js nucleus daemon`, whose IMAGE NAME is
 * `node.exe`, NOT `mneme.exe`. So image-name kill never touched it. A
 * daemon that loaded a native module (libvips-42.dll via the OPTIONAL
 * @huggingface/transformers→sharp path) keeps that DLL memory-mapped and
 * locked → `npm i -g mneme-ai` fails with EBUSY when it tries to
 * overwrite the DLL.
 *
 * THE FIX — three deterministic, pure-JS layers (no native, no deps):
 *
 *   1. PID-LEASE          read ~/.mneme-global/heartbeats/*.beat — every
 *                         live Mneme process leases its {pid, holdsPaths}
 *                         there. Authoritative for daemons that registered.
 *
 *   2. CMDLINE-MATCH      query the OS process table (wmic → PowerShell on
 *                         Windows; `ps` on POSIX) and kill any process whose
 *                         COMMAND LINE looks like a Mneme daemon
 *                         (`mneme.js`/`nucleus daemon`) even if it never
 *                         wrote a heartbeat (old version, crashed registry,
 *                         deleted beat file). This is the real node.exe fix.
 *
 *   3. HANDLE-ORACLE      replace the old blind `wait(300)`/`wait(500)` with
 *                         a DETERMINISTIC gate: loop `fs.openSync(dll,'r+')`
 *                         (exclusive on Windows) and proceed the instant the
 *                         OS confirms the handle is free — proof, not hope.
 *                         Falls back to the v2.19.61 rename-sideways trick if
 *                         the handle never frees.
 *
 * CONTRACT: this script must NEVER block an install. Every path is wrapped
 * best-effort and the process ALWAYS exits 0. It depends on ZERO node_modules
 * (preinstall runs before deps are installed) — node builtins only. It is
 * ALSO importable: `require()` exposes the pure functions for the test suite
 * without running the IO side effects (guarded by require.main === module).
 *
 * RELATIONSHIP TO THE SHIPPED preinstall. This module is the unit-tested +
 * SUPER-QUAN-probed REFERENCE implementation of the FULL reaper (incl. the
 * cmdline-match daemon kill), AND a runtime helper for `mneme upgrade` (which
 * runs in a normal node context, free of the cmd.exe constraints below).
 *
 * It is NOT what npm runs at preinstall. The shipped `scripts.preinstall` is a
 * LEAN inline `node -e` that does the cmd-SAFE subset: trail + image-kill +
 * heartbeat-PID reap (which already covers `node.exe …mneme.js`, since the
 * daemon registers a .beat) + Handle-Oracle DLL gate + sweep. It deliberately
 * OMITS the cmdline-match OS-process query, because that needs PowerShell/wmic
 * with pipes/quotes that DO NOT survive `cmd /d /s /c "node -e \"…\""`:
 *   • v2.75.0 — generated the inline from this whole 18.5 KB file → exceeded
 *     the Windows cmd.exe ~8191-char limit → "command line is too long".
 *   • v2.75.1 — a leaner inline still embedded a PowerShell `… | Select-Object`
 *     with literal double-quotes; the `"` broke cmd quoting and exposed `|` to
 *     cmd → "'Select-Object' is not recognized" → uninstallable on Windows.
 * Lesson: the inline must be < 8000 chars AND contain ZERO literal `"`. Guards:
 * probe.preinstall.reaps_node_daemon (length + no-double-quote + markers) and
 * P7 (incl. a faithful `cmd /d /s /c` smoke). Referencing a package file from
 * preinstall is also out (v2.19.48/49 scar: file may not exist pre-extract).
 * The cmdline-match safety-net therefore lives HERE, for the `mneme upgrade`
 * path, not in the npm preinstall.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const IS_WIN = process.platform === "win32";

/* ── tiny helpers ─────────────────────────────────────────────────────── */

/** Bounded synchronous sleep. preinstall must be synchronous (npm waits on
 *  the process), so we busy-wait — but the HANDLE-ORACLE exits early the
 *  instant the lock frees, so total spin time is normally a few ms. */
function busyWait(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) { /* spin */ }
}

function organDir() { return path.join(os.homedir(), ".mneme-global"); }
function heartbeatDir() { return path.join(organDir(), "heartbeats"); }

/* ── PURE FUNCTION 1: does a command line look like a Mneme daemon? ────────
 *
 * The daemon is spawned as `node …/bin/mneme.js nucleus daemon [--detach]`
 * (see nucleus_daemon.ts). We match the SCRIPT path + the daemon subcommand,
 * NOT a bare "mneme" substring (which would false-positive on, say, an editor
 * opened on a file called mneme.ts, or this very preinstall process). */
function matchesMnemeDaemonCmdline(cmdline) {
  if (typeof cmdline !== "string" || cmdline.length === 0) return false;
  const c = cmdline.toLowerCase();
  // Never match the installer/preinstall itself.
  if (c.includes("preinstall-mneme") || c.includes("postinstall-mneme")) return false;
  // Must reference the mneme CLI entrypoint (bin/mneme.js or a `mneme` shim
  // invoking a .js) AND a daemon-shaped subcommand.
  const refsMnemeJs = /(^|[\\/\s"'])mneme\.js([\s"']|$)/.test(c) || c.includes("bin\\mneme.js") || c.includes("bin/mneme.js") || c.includes("mneme-ai");
  const isDaemonish = c.includes("nucleus") || c.includes("daemon") || c.includes("--detach");
  return refsMnemeJs && isDaemonish;
}

/* ── PURE FUNCTION 2: parse the Windows `wmic … /format:csv` table ────────
 *
 * wmic CSV columns are: Node,CommandLine,ProcessId (header order varies, so
 * we locate columns by header name). CommandLine itself can contain commas,
 * so we DON'T naive-split: we take the FIRST field (Node=hostname) and the
 * LAST field (ProcessId) and treat everything between as the command line. */
function parseWmicCsv(stdout) {
  if (typeof stdout !== "string") return [];
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  // Find header row (contains "ProcessId").
  let headerIdx = lines.findIndex((l) => /ProcessId/i.test(l) && l.includes(","));
  if (headerIdx < 0) return [];
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    const first = row.indexOf(",");
    const last = row.lastIndexOf(",");
    if (first < 0 || last <= first) continue;
    const pid = parseInt(row.slice(last + 1).trim(), 10);
    const cmdline = row.slice(first + 1, last).trim();
    if (Number.isFinite(pid) && pid > 0) out.push({ pid, cmdline });
  }
  return out;
}

/* ── PURE FUNCTION 3: parse PowerShell CSV (ProcessId,CommandLine) ──────── */
function parsePowershellCsv(stdout) {
  if (typeof stdout !== "string") return [];
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // "<pid>","<cmdline maybe with commas>"
    const m = line.match(/^"?(\d+)"?\s*,\s*"?(.*?)"?$/);
    if (m) {
      const pid = parseInt(m[1], 10);
      if (Number.isFinite(pid) && pid > 0) out.push({ pid, cmdline: m[2] || "" });
    }
  }
  return out;
}

/* ── PURE FUNCTION 4: parse POSIX `ps -eo pid=,args=` ─────────────────────  */
function parsePosixPs(stdout) {
  if (typeof stdout !== "string") return [];
  const out = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s+(.*)$/);
    if (m) {
      const pid = parseInt(m[1], 10);
      if (Number.isFinite(pid) && pid > 0) out.push({ pid, cmdline: m[2] });
    }
  }
  return out;
}

/* ── PURE FUNCTION 5: select daemon PIDs to kill (exclude self) ──────────── */
function selectDaemonPids(procs, selfPid) {
  if (!Array.isArray(procs)) return [];
  const seen = new Set();
  const out = [];
  for (const p of procs) {
    if (!p || typeof p.pid !== "number" || p.pid <= 0) continue;
    if (p.pid === selfPid) continue;
    if (!matchesMnemeDaemonCmdline(p.cmdline)) continue;
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    out.push(p.pid);
  }
  return out;
}

/* ── PURE FUNCTION 6: known libvips/native DLL candidate paths ───────────── */
function libvipsDllCandidates(npmGlobalPkgDir, isWindows) {
  if (!isWindows) return [];
  const nm = path.join(npmGlobalPkgDir, "node_modules");
  return [
    path.join(nm, "@img", "sharp-libvips-win32-x64", "lib", "libvips-42.dll"),
    path.join(nm, "@img", "sharp-libvips-win32-x64", "lib", "libvips-cpp-8.17.3.dll"),
    path.join(nm, "sharp", "build", "Release", "sharp-win32-x64.node"),
  ];
}

/* ── HANDLE-ORACLE: deterministic "is this file unlocked?" ────────────────
 *
 * On Windows, fs.openSync(path,'r+') fails with EBUSY/EPERM while another
 * process holds the file mapped. Success = nobody holds it = safe to
 * overwrite. We inject openFn for testing. Returns true if free / absent. */
function tryExclusiveOpen(filePath, openFn) {
  const open = openFn || ((p) => { const fd = fs.openSync(p, "r+"); fs.closeSync(fd); });
  try {
    if (!fs.existsSync(filePath)) return true; // nothing to lock
  } catch { /* fall through to open attempt */ }
  try { open(filePath); return true; }
  catch { return false; }
}

/** Loop tryExclusiveOpen until released or tries exhausted. Deterministic
 *  proof-of-release; returns the moment the OS frees the handle. */
function waitForHandleRelease(filePath, opts) {
  const o = opts || {};
  const tries = typeof o.tries === "number" ? o.tries : 40;
  const intervalMs = typeof o.intervalMs === "number" ? o.intervalMs : 50;
  const openFn = o.openFn;
  const sleep = o.sleep || busyWait;
  for (let i = 1; i <= tries; i++) {
    if (tryExclusiveOpen(filePath, openFn)) return { released: true, attempts: i };
    if (i < tries) sleep(intervalMs);
  }
  return { released: false, attempts: tries };
}

/* ── IO: read PID leases from the heartbeat registry ─────────────────────── */
function readHeartbeatLeases(dir) {
  const d = dir || heartbeatDir();
  const out = [];
  let entries;
  try { entries = fs.readdirSync(d); } catch { return out; }
  for (const f of entries) {
    if (!f.endsWith(".beat")) continue;
    try {
      const beat = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      if (typeof beat.pid === "number" && beat.pid > 0) {
        out.push({ pid: beat.pid, holdsPaths: Array.isArray(beat.holdsPaths) ? beat.holdsPaths : [], beatFile: path.join(d, f) });
      }
    } catch { /* corrupt — skip */ }
  }
  return out;
}

/* ── IO: query the OS process table (best-effort) ────────────────────────── */
function queryProcessTable() {
  try {
    if (IS_WIN) {
      // Prefer wmic (fast, present on most Windows); fall back to PowerShell
      // CIM (wmic is removed on some Win11 builds).
      const w = spawnSync("wmic", ["process", "get", "Name,ProcessId,CommandLine", "/format:csv"],
        { shell: true, windowsHide: true, timeout: 6000, encoding: "utf8" });
      if (w.status === 0 && typeof w.stdout === "string" && /ProcessId/i.test(w.stdout)) {
        return parseWmicCsv(w.stdout);
      }
      const ps = spawnSync("powershell",
        ["-NoProfile", "-NonInteractive", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"],
        { shell: false, windowsHide: true, timeout: 8000, encoding: "utf8" });
      if (typeof ps.stdout === "string") return parsePowershellCsv(ps.stdout);
      return [];
    }
    const r = spawnSync("ps", ["-eo", "pid=,args="], { timeout: 6000, encoding: "utf8" });
    if (typeof r.stdout === "string") return parsePosixPs(r.stdout);
    return [];
  } catch { return []; }
}

/* ── IO: kill a list of PIDs (Windows-correct taskkill /F /PID) ──────────── */
function killPids(pids, isWindows) {
  const win = typeof isWindows === "boolean" ? isWindows : IS_WIN;
  const out = [];
  for (const pid of pids || []) {
    if (typeof pid !== "number" || pid <= 0 || pid === process.pid) { out.push({ pid, killed: false, reason: "skip" }); continue; }
    try {
      if (win) {
        const r = spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"], { shell: true, windowsHide: true, timeout: 4000, stdio: "ignore" });
        out.push({ pid, killed: r.status === 0 });
      } else {
        try { process.kill(pid, "SIGTERM"); } catch { /* */ }
        busyWait(120);
        try { process.kill(pid, "SIGKILL"); } catch { /* */ }
        out.push({ pid, killed: true });
      }
    } catch { out.push({ pid, killed: false, reason: "throw" }); }
  }
  return out;
}

/* ── HMAC-chained trail (tamper-evident install breadcrumb) ──────────────── */
function makeTrail(organ, version) {
  const trailPath = path.join(organ, "preinstall-trail.jsonl");
  const secret = process.env["MNEME_PREINSTALL_TRAIL_SECRET"] || "mneme-preinstall-trail-v1";
  const lastSig = () => {
    try {
      if (!fs.existsSync(trailPath)) return "genesis";
      const lines = fs.readFileSync(trailPath, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length === 0) return "genesis";
      const last = JSON.parse(lines[lines.length - 1]);
      return typeof last.sig === "string" ? last.sig : "genesis";
    } catch { return "genesis"; }
  };
  return (step, ok, details) => {
    try {
      const prevSig = lastSig();
      const body = { v: 2, ts: new Date().toISOString(), version, step, ok, ...(details ? { details } : {}), pid: process.pid, prevSig };
      const sig = crypto.createHmac("sha256", secret).update(prevSig + "::" + JSON.stringify(body)).digest("hex");
      fs.appendFileSync(trailPath, JSON.stringify({ ...body, sig }) + "\n", "utf8");
    } catch { /* trail is best-effort */ }
  };
}

/* ── ORCHESTRATOR ─────────────────────────────────────────────────────────  */
function runPreinstall(opts) {
  const o = opts || {};
  const home = os.homedir();
  const organ = o.organDir || organDir();
  const beatDir = o.heartbeatDir || heartbeatDir();
  // Injection points (default to real IO; tests override for hermeticity).
  const queryProcs = o.queryProcs || queryProcessTable;
  const killFn = o.killFn || killPids;
  const version = process.env["npm_package_version"] || "unknown";
  const result = { ok: true, version, killedPids: [], handleOracle: [], renamed: 0, swept: 0, leasePids: [], cmdlinePids: [] };
  try { if (!fs.existsSync(organ)) fs.mkdirSync(organ, { recursive: true, mode: 0o700 }); } catch { /* */ }
  const trail = makeTrail(organ, version);
  trail("preinstall-start", true, { v: "2.75.0", reaper: true });

  // 1. announce incoming install (other Mneme processes back off on seeing this).
  try {
    fs.writeFileSync(path.join(organ, "install-incoming.flag"),
      JSON.stringify({ v: 2, announcedAt: new Date().toISOString(), announcerPid: process.pid, reason: "preinstall-hook" }),
      { encoding: "utf8", mode: 0o600 });
    trail("flag-written", true);
  } catch { trail("flag-written", false); }

  // 2. image-name kill (legacy; catches a real mneme.exe shim if one exists).
  if (IS_WIN && o.imageKill !== false) {
    try { spawnSync("taskkill", ["/F", "/IM", "mneme.exe", "/T"], { shell: true, windowsHide: true, timeout: 5000, stdio: "ignore" }); } catch { /* */ }
  }

  // 3. PID-LEASE: kill every daemon that leased a heartbeat (authoritative).
  //    v2.76.0 — also harvest each lease's DECLARED held DLLs (holdsPaths) so
  //    the Handle-Oracle (step 5) targets the EXACT handles a dead daemon held,
  //    not just static path guesses — works for any install layout, cmd-safe.
  const leases = readHeartbeatLeases(beatDir);
  const leasePids = leases.map((l) => l.pid).filter((p) => p !== process.pid);
  result.leasePids = leasePids.slice();
  const leaseHeldPaths = [];
  for (const l of leases) {
    if (Array.isArray(l.holdsPaths)) for (const p of l.holdsPaths) { if (typeof p === "string" && p.length > 0) leaseHeldPaths.push(p); }
    if (l.beatFile) { try { fs.unlinkSync(l.beatFile); } catch { /* */ } }
  }
  const killedLease = killFn(leasePids);

  // 4. CMDLINE-MATCH: the real node.exe fix — kill daemons NOT in the
  //    registry (old version / crashed / deleted beat) by matching cmdline.
  const procs = queryProcs();
  const cmdlinePids = selectDaemonPids(procs, process.pid).filter((p) => !leasePids.includes(p));
  result.cmdlinePids = cmdlinePids.slice();
  const killedCmd = killFn(cmdlinePids);
  result.killedPids = killedLease.concat(killedCmd).filter((k) => k.killed).map((k) => k.pid);
  trail("daemons-reaped", true, { lease: leasePids.length, cmdline: cmdlinePids.length, killed: result.killedPids.length });

  // 5. HANDLE-ORACLE: deterministically wait for the native DLLs to free, then
  //    rename-sideways only if the lock genuinely persists. The path set is the
  //    UNION of static candidates (npm global layouts) + the exact paths the
  //    dead daemons DECLARED they held (leaseHeldPaths) — deduped.
  let renamed = 0;
  const dllPrefixes = o.npmGlobalDirs || defaultNpmGlobalDirs(home);
  const dllSet = new Set();
  for (const pkgDir of dllPrefixes) for (const dll of libvipsDllCandidates(pkgDir, IS_WIN)) dllSet.add(dll);
  for (const p of leaseHeldPaths) dllSet.add(p);
  result.handleOracleTargets = dllSet.size;
  for (const dll of dllSet) {
    let present = false;
    try { present = fs.existsSync(dll); } catch { /* */ }
    if (!present) continue;
    const gate = waitForHandleRelease(dll, { tries: 40, intervalMs: 50 });
    result.handleOracle.push({ dll, released: gate.released, attempts: gate.attempts });
    if (!gate.released) {
      // Lock never freed — fall back to the v2.19.61 rename-sideways trick
      // so npm can lay down the new DLL beside the locked (orphaned) one.
      try { fs.renameSync(dll, dll + ".locked-" + Date.now() + "-" + process.pid); renamed++; } catch { /* */ }
    }
  }
  result.renamed = renamed;
  trail("handle-oracle", true, { checked: result.handleOracle.length, renamed });

  // 6. sweep abandoned npm staging dirs (.mneme-ai-* leftovers).
  let swept = 0;
  try {
    for (const npmParent of (o.sweepDirs || defaultNpmNodeModules(home))) {
      let entries;
      try { entries = fs.readdirSync(npmParent); } catch { continue; }
      for (const entry of entries) {
        if (entry.startsWith(".mneme-ai-")) {
          try { fs.rmSync(path.join(npmParent, entry), { recursive: true, force: true }); swept++; } catch { /* */ }
        }
      }
    }
  } catch { /* */ }
  result.swept = swept;
  trail("staging-swept", true, { swept });
  trail("preinstall-end", true);
  return result;
}

/* ── npm global location heuristics (Windows + POSIX, multi-version-mgr) ──── */
function defaultNpmGlobalDirs(home) {
  const dirs = [];
  const push = (p) => { if (p) dirs.push(path.join(p, "mneme-ai")); };
  if (IS_WIN) {
    push(path.join(home, "AppData", "Roaming", "npm", "node_modules"));
    push(path.join(path.dirname(process.execPath), "node_modules"));
  } else {
    push("/usr/local/lib/node_modules");
    push("/usr/lib/node_modules");
    push(path.join(home, ".npm-global", "node_modules"));
  }
  return dirs;
}
function defaultNpmNodeModules(home) {
  if (IS_WIN) {
    return [path.join(home, "AppData", "Roaming", "npm", "node_modules"), path.join(path.dirname(process.execPath), "node_modules")];
  }
  return ["/usr/local/lib/node_modules", path.join(home, ".npm-global", "node_modules")];
}

/* ── exports (for the test suite) ─────────────────────────────────────────  */
module.exports = {
  matchesMnemeDaemonCmdline,
  parseWmicCsv,
  parsePowershellCsv,
  parsePosixPs,
  selectDaemonPids,
  libvipsDllCandidates,
  tryExclusiveOpen,
  waitForHandleRelease,
  readHeartbeatLeases,
  queryProcessTable,
  killPids,
  runPreinstall,
};

/* ── run on direct invoke; ALWAYS exit 0 so install never aborts ─────────── */
if (require.main === module) {
  try { runPreinstall(); } catch { /* never block install */ }
  process.exit(0);
}

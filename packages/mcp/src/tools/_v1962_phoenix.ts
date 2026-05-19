/**
 * v2.19.62 PHOENIX PHASE 1 MCP TOOLS — 6 callable surfaces.
 *
 *   mneme.phoenix.extract_dll     — copy libvips to per-PID tmpdir + redirect PATH
 *   mneme.phoenix.dll_cleanup     — remove this process's tmp DLL dir
 *   mneme.phoenix.dll_sweep       — sweep orphan mneme-vips-<pid> dirs from dead PIDs
 *   mneme.phoenix.custodian_sweep — periodic cleanup organ (one cycle)
 *   mneme.phoenix.sentinel_probe  — HMAC chain + handle-leak integrity probe
 *   mneme.phoenix.surgeon_diagnose — latency-driven restart verdict
 *
 * Plus 1 read-only observer (the Scout):
 *   mneme.phoenix.scout_poll      — passive npm registry probe
 *
 * Plus 1 composed surface:
 *   mneme.phoenix.organs_tick     — runs Custodian + Sentinel + Surgeon in one shot
 *
 * 12th world-first: per-PID DLL hostage extraction as an MCP-callable primitive.
 * No AI tool worldwide ships this — Electron / VS Code use it INTERNALLY, but
 * nobody surfaces it as a reusable npm package primitive.
 */

import type { MnemeTool } from "./_types.js";

export const phoenixExtractDllTool: MnemeTool = {
  name: "mneme.phoenix.extract_dll",
  category: "lab",
  description: "🔥 PHOENIX P3 — copy libvips DLLs to per-PID %TEMP%/mneme-vips-{pid}/ + prepend tmpdir to PATH (Windows) / DYLD_LIBRARY_PATH (macOS) / LD_LIBRARY_PATH (Linux). Disjoint-resource-set invariant: no two daemons share the canonical install-time DLL path. EBUSY becomes structurally impossible.",
  whenToUse: "At daemon boot, BEFORE the first `require('sharp')`. The shepherd calls this internally; AI agents can trigger it for diagnostic/manual recovery.",
  triggers: ["extract dll", "phoenix dll", "redirect libvips", "per-pid dll"],
  inputSchema: {
    type: "object",
    properties: {
      packageRoot: { type: "string", description: "Override package root (where node_modules/@img/sharp-libvips-* lives). Default: auto-detect." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Extract sharp DLLs to safe per-PID tmpdir", args: {}, expectedOutput: "{ ok: true, filesCopied: 3, bytesCopied: 12345678, envVarSet: 'PATH' }" }],
  pitfalls: [
    "If sharp is not installed, returns ok=false with error='no libvips dir found'.",
    "On non-Windows, modifies DYLD_LIBRARY_PATH (macOS) or LD_LIBRARY_PATH (Linux) instead of PATH.",
    "Idempotent — re-running just refreshes the tmp dir; safe to call from autoboot.",
  ],
  composeWith: ["mneme.phoenix.dll_cleanup", "mneme.phoenix.dll_sweep", "mneme.dll.evict"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const plan = core.phoenix.dllExtraction.planExtraction(
      typeof args["packageRoot"] === "string" ? { packageRoot: args["packageRoot"] as string } : undefined,
    );
    if (!plan) {
      return {
        data: { ok: false, error: "no libvips dir found (sharp may not be installed)" },
        wisdom: "🔥 PHOENIX skipped — no sharp-libvips installation detected.",
        confidence: { level: "medium" },
      };
    }
    const r = core.phoenix.dllExtraction.extractAndRedirect(plan);
    return {
      data: r,
      wisdom: r.ok
        ? `🔥 ${r.filesCopied} DLL(s) extracted to ${r.plan.tmpDir} · ${r.envVarSet} redirected · ${r.durationMs}ms`
        : `🔥 ⚠ extraction failed: ${r.error ?? "unknown"}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const phoenixDllCleanupTool: MnemeTool = {
  name: "mneme.phoenix.dll_cleanup",
  category: "lab",
  description: "🔥 PHOENIX P3 — remove THIS process's per-PID DLL tmpdir. Safe to call on graceful shutdown.",
  whenToUse: "Process is shutting down; AI agent wants to clean its own DLL tmp dir explicitly. Also auto-fires on process('exit').",
  triggers: ["phoenix cleanup", "dll cleanup", "remove pid tmp"],
  inputSchema: {
    type: "object",
    properties: {
      pid: { type: "number", description: "PID to clean up. Default: current process PID." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Clean my DLL tmp dir", args: {}, expectedOutput: "{ removed: true, tmpDir: '...' }" }],
  pitfalls: ["Cleaning another live process's tmp dir is the caller's responsibility — this just deletes whatever it finds."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const pid = typeof args["pid"] === "number" ? args["pid"] as number : process.pid;
    const tmpDir = core.phoenix.dllExtraction.pidTmpDir(pid);
    const removed = core.phoenix.dllExtraction.cleanupExtraction({ pid });
    return {
      data: { removed, tmpDir, pid },
      wisdom: removed ? `🔥 cleaned ${tmpDir}` : `🔥 nothing to clean for pid ${pid}`,
      confidence: { level: "high" },
    };
  },
};

export const phoenixDllSweepTool: MnemeTool = {
  name: "mneme.phoenix.dll_sweep",
  category: "lab",
  description: "🔥 PHOENIX P3 — sweep all mneme-vips-<pid> dirs in OS tmpdir from DEAD processes (probes via process.kill(pid, 0)). Skips live PIDs + own PID. Idempotent.",
  whenToUse: "Periodic hygiene (Custodian fires this every 5min). After daemon crash. CLI startup.",
  triggers: ["dll sweep orphans", "phoenix sweep", "clean dead pid dlls"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Reclaim DLL tmp from dead daemons", args: {}, expectedOutput: "{ swept: 4, bytesReclaimed: 50000000, failed: 0 }" }],
  pitfalls: ["A live foreign-user PID may register as EPERM (treated as alive — safe-default skip)."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const r = core.phoenix.dllExtraction.sweepOrphanTmpDirs();
    const mb = (r.bytesReclaimed / 1024 / 1024).toFixed(1);
    return {
      data: r,
      wisdom: `🔥 swept ${r.swept} orphan(s) · reclaimed ${mb} MB · ${r.failed} failed`,
      confidence: { level: "high" },
    };
  },
};

export const phoenixCustodianSweepTool: MnemeTool = {
  name: "mneme.phoenix.custodian_sweep",
  category: "lab",
  description: "🧹 PHOENIX P5 — Custodian organ — sweeps orphan per-PID tmp dirs + stale .locked-* orphans (from v2.19.61 rename-sideways) + global heartbeat hygiene. One cycle; idempotent + non-throwing.",
  whenToUse: "Periodic (every 5min in daemon). Manually trigger after install failure or to verify cleanup logic.",
  triggers: ["custodian sweep", "phoenix cleanup", "tmp hygiene"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run a Custodian sweep cycle", args: {}, expectedOutput: "{ tmpDirsSwept: 2, globalOrphansSwept: 5, totalReclaimedBytes: 12000000 }" }],
  pitfalls: ["Best-effort across all subsystems; partial failures are silenced. Counts may underreport on permission-denied entries."],
  composeWith: ["mneme.phoenix.dll_sweep", "mneme.dll.sweep"],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const r = core.phoenix.organs.runCustodianCycle();
    const mb = (r.totalReclaimedBytes / 1024 / 1024).toFixed(1);
    return {
      data: r,
      wisdom: `🧹 custodian · ${r.tmpDirsSwept} tmp dir(s) + ${r.globalOrphansSwept} locked orphan(s) swept · ${mb} MB reclaimed · ${r.durationMs}ms`,
      confidence: { level: "high" },
    };
  },
};

export const phoenixSentinelProbeTool: MnemeTool = {
  name: "mneme.phoenix.sentinel_probe",
  category: "audit",
  description: "🔬 PHOENIX P5 — Sentinel organ — verifies HMAC chain integrity (caller injects verifyHmacChain) + checks open-handle count for leak (count > baseline×2). Returns verdict only; caller commits any escalation.",
  whenToUse: "Periodic integrity check (every 10min in daemon). Manual run after suspected corruption or before quarantine.",
  triggers: ["sentinel probe", "integrity check", "handle leak"],
  inputSchema: {
    type: "object",
    properties: {
      handleBaseline: { type: "number", description: "Open-handle baseline; leak detected if count > 2× this. Default 50." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Probe Sentinel integrity now", args: {}, expectedOutput: "{ hmacChainOk: true, handleLeakDetected: false, recommendation: 'healthy' }" }],
  pitfalls: [
    "MCP path runs without an HMAC verifier injection — chain.ok defaults to true; the in-daemon scheduler injects the real verifier.",
    "handleCount=-1 means the caller did not inject a counter (MCP default).",
  ],
  composeWith: ["mneme.phoenix.organs_tick", "mneme.aegis.status"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const baseline = typeof args["handleBaseline"] === "number" ? args["handleBaseline"] as number : undefined;
    const r = core.phoenix.organs.runSentinelCycle(
      baseline !== undefined ? { handleBaseline: baseline } : undefined,
    );
    return {
      data: r,
      wisdom: `🔬 sentinel · chain=${r.hmacChainOk ? "ok" : "BROKEN"} · handles=${r.handleCount}/baseline ${r.handleBaseline} · ${r.recommendation}`,
      confidence: { level: r.hmacChainOk ? "high" : "low" },
    };
  },
};

export const phoenixSurgeonDiagnoseTool: MnemeTool = {
  name: "mneme.phoenix.surgeon_diagnose",
  category: "audit",
  description: "🩺 PHOENIX P5 — Surgeon organ — examines per-organ latency stats; flags organs whose p99 >= 3× baseline OR have 3+ consecutive failures. Returns a list of organs to restart. Pure verdict; caller commits restarts.",
  whenToUse: "Periodic (every 5min in daemon). Before deciding to restart an organ — feed Surgeon your latency stats and it tells you which ones are degraded.",
  triggers: ["surgeon diagnose", "organ restart verdict", "latency degraded"],
  inputSchema: {
    type: "object",
    properties: {
      stats: {
        type: "array",
        description: "Per-organ latency stats: { name, p99Ms, baselineMs, consecutiveFailures? }",
      },
      degradationFactor: { type: "number", description: "Restart threshold (p99/baseline). Default 3." },
      maxConsecutiveFailures: { type: "number", description: "Restart threshold (failures). Default 3." },
    },
    required: ["stats"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Diagnose which organs need restart",
    args: { stats: [{ name: "indexer", p99Ms: 5000, baselineMs: 1000 }, { name: "embedder", p99Ms: 100, baselineMs: 80 }] },
    expectedOutput: "{ organsExamined: 2, organsToRestart: [{ name: 'indexer', reason: 'p99 5000ms is 5.0x baseline 1000ms (threshold 3x)' }] }",
  }],
  pitfalls: ["Baseline 0 disables the ratio check (avoids divide-by-zero); falls back to consecutiveFailures only."],
  composeWith: ["mneme.phoenix.organs_tick", "mneme.install.diagnose"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    type OLS = Parameters<typeof core.phoenix.organs.runSurgeonCycle>[0][number];
    const stats = Array.isArray(args["stats"]) ? args["stats"] as OLS[] : [];
    const opts: { degradationFactor?: number; maxConsecutiveFailures?: number } = {};
    if (typeof args["degradationFactor"] === "number") opts.degradationFactor = args["degradationFactor"] as number;
    if (typeof args["maxConsecutiveFailures"] === "number") opts.maxConsecutiveFailures = args["maxConsecutiveFailures"] as number;
    const r = core.phoenix.organs.runSurgeonCycle(stats, opts);
    return {
      data: r,
      wisdom: r.organsToRestart.length === 0
        ? `🩺 surgeon · ${r.organsExamined} organ(s) examined · all healthy · ${r.durationMs}ms`
        : `🩺 surgeon · ${r.organsToRestart.length}/${r.organsExamined} flagged for restart: ${r.organsToRestart.map((o) => o.name).join(", ")}`,
      confidence: { level: "high" },
    };
  },
};

export const phoenixScoutPollTool: MnemeTool = {
  name: "mneme.phoenix.scout_poll",
  category: "lab",
  description: "🦉 PHOENIX P4 step 1 — Scout organ — passive npm registry probe. HTTPS GET registry.npmjs.org/<pkg>/latest → verdict: up-to-date / upgrade-available / unreachable. Cached 5min. NEVER spawns npm install; caller decides what to do.",
  whenToUse: "Before pulse generation (so pulse can advertise upgrades). After daemon boot. Periodic (every 30min) to detect new releases without flooding the registry.",
  triggers: ["scout poll", "npm registry probe", "phoenix upgrade check"],
  inputSchema: {
    type: "object",
    properties: {
      runningVersion: { type: "string", description: "Current package version. Required (caller knows their own version)." },
      packageName: { type: "string", description: "npm package name. Default: mneme-ai." },
      cacheTtlMs: { type: "number", description: "Cache TTL. Default 5min." },
      timeoutMs: { type: "number", description: "Request timeout. Default 8s." },
    },
    required: ["runningVersion"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Is there a Mneme upgrade?",
    args: { runningVersion: "2.19.62" },
    expectedOutput: "{ verdict: 'up-to-date', latestVersion: '2.19.62', cacheHit: false }",
  }],
  pitfalls: [
    "Offline / DNS failure / rate-limit → verdict='unreachable' (NEVER throws — daemon must stay alive).",
    "Cache is in-memory per-process; restarting the daemon resets it.",
  ],
  composeWith: ["mneme.publish.probe_all", "mneme.system.upgrade"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const opts: Parameters<typeof core.phoenix.scout.runScoutCycle>[1] = {};
    if (typeof args["packageName"] === "string") opts.packageName = args["packageName"] as string;
    if (typeof args["cacheTtlMs"] === "number") opts.cacheTtlMs = args["cacheTtlMs"] as number;
    if (typeof args["timeoutMs"] === "number") opts.timeoutMs = args["timeoutMs"] as number;
    const r = await core.phoenix.scout.runScoutCycle(String(args["runningVersion"]), opts);
    return {
      data: r,
      wisdom: r.verdict === "upgrade-available"
        ? `🦉 scout · upgrade available · ${r.runningVersion} → ${r.latestVersion} (${r.packageName})`
        : r.verdict === "up-to-date"
        ? `🦉 scout · up-to-date · ${r.runningVersion} (cache${r.cacheHit ? " hit" : " miss"} ${r.durationMs}ms)`
        : `🦉 scout · registry unreachable · ${r.reachability.error ?? "unknown"}`,
      confidence: { level: r.verdict === "unreachable" ? "low" : "high" },
    };
  },
};

export const phoenixOrgansTickTool: MnemeTool = {
  name: "mneme.phoenix.organs_tick",
  category: "lab",
  description: "🔥 PHOENIX P5 — runs ALL 3 priority-1 organs (Custodian + Sentinel + Surgeon) in one composed cycle. Returns 3 verdicts + summary. Used by daemon's tickAllOrgans loop.",
  whenToUse: "Periodic (every 5-10min in daemon). Manual snapshot of all-organs health.",
  triggers: ["organs tick", "phoenix all organs", "swarm health"],
  inputSchema: {
    type: "object",
    properties: {
      surgeonStats: { type: "array", description: "Optional: per-organ latency stats for Surgeon. Default empty." },
      handleBaseline: { type: "number", description: "Optional: Sentinel handle baseline. Default 50." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run all phoenix organs now", args: {}, expectedOutput: "{ custodian: {...}, sentinel: {...}, surgeon: {...}, durationMs: 42 }" }],
  pitfalls: ["Composed run is sub-100ms in steady state but can spike to seconds on first-run sweep of large tmpdirs."],
  composeWith: ["mneme.phoenix.custodian_sweep", "mneme.phoenix.sentinel_probe", "mneme.phoenix.surgeon_diagnose"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    type AllOrgansOpts = NonNullable<Parameters<typeof core.phoenix.organs.runAllOrgans>[0]>;
    type OLS = NonNullable<AllOrgansOpts["surgeonStats"]>[number];
    const opts: AllOrgansOpts = {};
    if (Array.isArray(args["surgeonStats"])) opts.surgeonStats = args["surgeonStats"] as OLS[];
    if (typeof args["handleBaseline"] === "number") opts.sentinel = { handleBaseline: args["handleBaseline"] as number };
    const r = core.phoenix.organs.runAllOrgans(opts);
    return {
      data: r,
      wisdom: `🔥 all-organs · custodian (${r.custodian.tmpDirsSwept + r.custodian.globalOrphansSwept} swept) · sentinel (${r.sentinel.recommendation}) · surgeon (${r.surgeon.organsToRestart.length} flagged) · ${r.durationMs}ms`,
      confidence: { level: r.sentinel.hmacChainOk ? "high" : "low" },
    };
  },
};

export const V1962_PHOENIX_TOOLS: MnemeTool[] = [
  phoenixExtractDllTool,
  phoenixDllCleanupTool,
  phoenixDllSweepTool,
  phoenixCustodianSweepTool,
  phoenixSentinelProbeTool,
  phoenixSurgeonDiagnoseTool,
  phoenixScoutPollTool,
  phoenixOrgansTickTool,
];

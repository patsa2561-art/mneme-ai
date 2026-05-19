/**
 * v2.19.61 DLL EVICTION MCP — expose the wild rename-sideways primitive.
 *
 *   mneme.dll.evict       — try rename-sideways then fall back to probe-wait
 *   mneme.dll.probe       — write-probe a path (returns when OS released handle)
 *   mneme.dll.sweep       — clean .locked-* orphans + stale .mneme-ai-* dirs
 *
 * AI agents call these during the upgrade pipeline. The shepherd (v2.19.57)
 * + install organ (v2.19.53) compose with these to make Windows EBUSY a
 * non-event: even if the daemon takes 30s to release its DLL handle, the
 * rename-sideways trick gives npm a clean slate in milliseconds.
 *
 * 11th world-first as MCP primitive. Helicone / Portkey route HTTP; nobody
 * ships callable Windows DLL eviction at the spec level.
 */

import type { MnemeTool } from "./_types.js";

export const dllEvictTool: MnemeTool = {
  name: "mneme.dll.evict",
  category: "lab",
  description: "🪄 DLL EVICTION — try the WILD rename-sideways trick first (Windows allows renaming loaded DLLs); fall back to wait-for-OS-handle-release if rename fails. Returns structured result. The end of EBUSY at SOURCE: npm gets a clean slate without anyone needing to kill the daemon.",
  whenToUse: "Before npm install -g mneme-ai on Windows where a daemon may be holding the libvips DLL. Used by shepherd internally; AI agents can call directly.",
  triggers: ["dll evict", "evict locked dll", "rename sideways", "free dll path"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file to evict (typically libvips-42.dll or sharp-win32-x64.node)." },
      maxProbeAttempts: { type: "number", description: "If rename fails, retry write-probe N times. Default 60 (60 × 500ms = 30s)." },
      probeIntervalMs: { type: "number", description: "ms between probe attempts. Default 500." },
    },
    required: ["path"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Evict the locked libvips DLL", args: { path: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@img\\sharp-libvips-win32-x64\\lib\\libvips-42.dll" }, expectedOutput: "{ ok, strategy: 'rename-sideways', evictionResult, probeResult, totalMs }" }],
  pitfalls: [
    "rename-sideways leaves a .locked-<ts>-<pid> orphan; clean it up later with mneme.dll.sweep.",
    "If rename fails AND probe retry exceeds maxProbeAttempts, returns ok=false — caller should alert user to manually kill the holder process.",
  ],
  composeWith: ["mneme.dll.probe", "mneme.dll.sweep", "mneme.install.upgrade_pipeline"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dllEviction.evictAndProbe(
      String(args["path"]),
      {
        ...(typeof args["maxProbeAttempts"] === "number" ? { maxProbeAttempts: args["maxProbeAttempts"] as number } : {}),
        ...(typeof args["probeIntervalMs"] === "number" ? { probeIntervalMs: args["probeIntervalMs"] as number } : {}),
      },
    );
    return {
      data: r,
      wisdom: r.ok
        ? `🪄 ${r.strategy} · ${r.totalMs}ms · ${r.path}`
        : `🪄 ⚠ failed (${r.probeResult.lastErrorCode ?? "unknown"}) after ${r.probeResult.attempts} attempts (${r.probeResult.totalWaitMs}ms)`,
      confidence: { level: "high" },
    };
  },
};

export const dllProbeTool: MnemeTool = {
  name: "mneme.dll.probe",
  category: "audit",
  description: "🪄 DLL EVICTION — write-probe a path in a retry loop. Returns when OS releases the handle (fs.openSync 'r+' succeeds). Use AFTER killing a process to confirm the kernel has actually released the DLL.",
  whenToUse: "Diagnostic: 'is this DLL still locked?' Post-kill verification before allowing npm to proceed.",
  triggers: ["dll probe", "probe writable", "is dll locked"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      maxAttempts: { type: "number", description: "Default 60." },
      intervalMs: { type: "number", description: "Default 500ms." },
    },
    required: ["path"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the DLL released?", args: { path: "C:\\path\\to\\libvips-42.dll", maxAttempts: 10, intervalMs: 200 }, expectedOutput: "{ writable: true, attempts: 3, totalWaitMs: 400 }" }],
  pitfalls: ["Probe uses busy-wait between attempts (preinstall context); for long timeouts call sparingly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dllEviction.probeWritable(
      String(args["path"]),
      {
        ...(typeof args["maxAttempts"] === "number" ? { maxAttempts: args["maxAttempts"] as number } : {}),
        ...(typeof args["intervalMs"] === "number" ? { intervalMs: args["intervalMs"] as number } : {}),
      },
    );
    return {
      data: r,
      wisdom: r.writable
        ? `🪄 writable after ${r.attempts} attempt(s) (${r.totalWaitMs}ms)`
        : `🪄 ⚠ still locked after ${r.attempts} attempts (${r.totalWaitMs}ms · ${r.lastErrorCode ?? "?"})`,
      confidence: { level: "high" },
    };
  },
};

export const dllSweepTool: MnemeTool = {
  name: "mneme.dll.sweep",
  category: "lab",
  description: "🪄 DLL EVICTION — clean orphan .locked-* files (from rename-sideways) + stale .mneme-ai-* staging dirs (from npm crashed-install). Idempotent. Call periodically or after upgrade.",
  whenToUse: "After mneme.dll.evict succeeds, sweep the orphan. After a failed npm install, clean stale staging. CLI startup hygiene.",
  triggers: ["dll sweep", "clean locked orphans", "sweep staging"],
  inputSchema: {
    type: "object",
    properties: {
      parentDir: { type: "string", description: "Directory to sweep. Default: npm global node_modules parent." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Clean orphan locked files", args: { parentDir: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@img\\sharp-libvips-win32-x64\\lib" }, expectedOutput: "{ lockedSwept: 3, stagingSwept: 0 }" }],
  pitfalls: ["Sweep is best-effort; files still locked are silently skipped (will be cleaned next time)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = (args["parentDir"] as string | undefined)
      ?? (process.platform === "win32"
        ? path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules")
        : "/usr/local/lib/node_modules");
    const lockedR = core.dllEviction.cleanLockedSideways(dir);
    const stagingR = core.dllEviction.cleanStaleStagingDirs(dir);
    return {
      data: {
        parentDir: dir,
        locked: lockedR,
        staging: stagingR,
        totalSwept: lockedR.swept + stagingR.swept,
      },
      wisdom: `🪄 swept ${lockedR.swept} locked + ${stagingR.swept} staging dir(s) at ${dir}`,
      confidence: { level: "high" },
    };
  },
};

export const V1961_DLL_EVICTION_TOOLS: MnemeTool[] = [
  dllEvictTool,
  dllProbeTool,
  dllSweepTool,
];

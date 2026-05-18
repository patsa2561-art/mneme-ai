/**
 * v2.19.53 INSTALL ORGAN MCP — expose the self-healing process-lineage
 * protocol as AI-agent-callable tools.
 *
 *   mneme.install.diagnose       — read heartbeats + lineage + DLL probe
 *   mneme.install.heal           — full heal pipeline (diagnose + reap + reprobe)
 *   mneme.install.reap_orphans   — just the reaper (dry-run supported)
 *   mneme.install.lineage        — read HMAC-chained spawn/exit ledger
 *   mneme.install.heartbeat_list — list known Mneme processes across all repos
 *
 * The killer macOS bonus: lsof-based handle holder detection. When a
 * .dylib is locked, `lsof -t {path}` returns the holding PIDs; the heal
 * pipeline targets THOSE specifically. Windows uses fs.openSync probe;
 * Linux uses lsof too. All three platforms via the same MCP surface.
 *
 * The killer Windows bonus: the reaper kills by EXACT PID from heartbeat
 * registry — NEVER "kill all node.exe" which would nuke the user's
 * editor / AI client / build watcher. Surgical not nuclear.
 */

import type { MnemeTool } from "./_types.js";

export const installDiagnoseTool: MnemeTool = {
  name: "mneme.install.diagnose",
  category: "audit",
  description: "🪄 INSTALL ORGAN — read heartbeats + lineage + DLL/dylib probes; return structured health report. The pre-install gate. Cross-platform (Windows libvips-42.dll + macOS libvips.42.dylib + Linux libvips.so.42).",
  whenToUse: "Before `npm install -g mneme-ai@latest`; whenever the user reports EBUSY/ENOTEMPTY/'install half-broke'; periodic install pipeline health snapshot.",
  triggers: ["install diagnose", "diagnose install", "install health check"],
  inputSchema: {
    type: "object",
    properties: {
      probedPaths: { type: "array", items: { type: "string" }, description: "Optional explicit list of .dll/.dylib/.so paths to probe. Default: platform-aware defaults under installRoot." },
      installRoot: { type: "string", description: "Root dir to derive default probe paths from (typically the npm-global install dir)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is my install safe right now?", args: { installRoot: "C:\\Users\\me\\AppData\\Roaming\\npm" }, expectedOutput: "{ ok, heartbeats: {alive, staleButAlive, tombstones}, probes: [...], recommendation }" }],
  pitfalls: ["Heartbeats only track Mneme-spawned processes — NOT other tools that may also hold the DLL (e.g., Photoshop on Windows for libvips). For non-Mneme holders, the probe will report locked but the heal pipeline can't reap them."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const paths = (args["probedPaths"] as string[] | undefined)
      ?? core.installOrgan.defaultLockableProbes(args["installRoot"] as string | undefined);
    const d = core.installOrgan.diagnoseInstall(paths);
    return {
      data: d,
      wisdom: `🪄 ${d.heartbeats.alive} alive · ${d.heartbeats.staleButAlive} stale · ${d.heartbeats.tombstones} tombstones · ${d.probes.filter((p) => !p.writable).length}/${d.probes.length} locked`,
      confidence: { level: "high" },
    };
  },
};

export const installHealTool: MnemeTool = {
  name: "mneme.install.heal",
  category: "lab",
  description: "🪄 INSTALL ORGAN — FULL heal pipeline: diagnose → reap orphan Mneme processes by EXACT PID (NOT 'kill all node') → wait for OS handle release → re-probe DLLs. Returns ok=true when install safe to retry. Cross-platform; surgical not nuclear.",
  whenToUse: "User hit EBUSY on `npm install -g mneme-ai`. Or post-incident cleanup. Or proactive: before scripting an unattended upgrade.",
  triggers: ["heal install", "install heal", "reap orphans", "fix ebusy"],
  inputSchema: {
    type: "object",
    properties: {
      probedPaths: { type: "array", items: { type: "string" } },
      installRoot: { type: "string" },
      dryRun: { type: "boolean", description: "Report what WOULD be reaped without actually killing." },
      gracePeriodMs: { type: "number", description: "ms to wait after SIGTERM before SIGKILL. Default 1000." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fix the EBUSY install error", args: { installRoot: "C:\\Users\\me\\AppData\\Roaming\\npm" }, expectedOutput: "{ ok, reap: {killed, failed}, postProbes: [...], remediation }" }],
  pitfalls: [
    "dryRun=true is the safe first call — confirms the reaper would target the right PIDs before actually killing them.",
    "Heal targets ONLY Mneme processes registered in ~/.mneme-global/heartbeats/. Non-Mneme processes holding the same DLL (rare but possible) are untouched.",
    "On Windows, after heal succeeds you still need to retry `npm install -g mneme-ai@latest` manually (or `--force` if npm cached a partial state).",
  ],
  composeWith: ["mneme.install.diagnose", "mneme.proof.mint"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const paths = (args["probedPaths"] as string[] | undefined)
      ?? core.installOrgan.defaultLockableProbes(args["installRoot"] as string | undefined);
    const opts = {
      ...(args["dryRun"] ? { dryRun: true } : {}),
      ...(typeof args["gracePeriodMs"] === "number" ? { gracePeriodMs: args["gracePeriodMs"] as number } : {}),
      skipPid: process.pid,
    };
    const r = core.installOrgan.healInstall(paths, opts);
    const lockedAfter = r.postProbes.filter((p) => !p.writable).length;
    return {
      data: r,
      wisdom: r.ok
        ? `🪄 healed · reaped ${r.reap.killed} orphan(s) · 0 locks remaining · install safe to retry`
        : `🪄 ⚠ ${r.reap.failed} reap failure(s) · ${lockedAfter} lock(s) remaining · ${r.remediation[0] ?? "manual intervention"}`,
      confidence: { level: "high" },
    };
  },
};

export const installReapOrphansTool: MnemeTool = {
  name: "mneme.install.reap_orphans",
  category: "lab",
  description: "🪄 INSTALL ORGAN — reap stale + alive Mneme processes via the heartbeat registry. SIGTERM → grace period → SIGKILL. NEVER kills non-Mneme processes (surgical not nuclear). Use mneme.install.heal for full pipeline; use this for just the reaping step.",
  whenToUse: "When you only want to reap (no DLL probe / no diagnosis). Composes inside mneme.install.heal.",
  triggers: ["reap orphans", "kill mneme orphans"],
  inputSchema: {
    type: "object",
    properties: {
      dryRun: { type: "boolean" },
      gracePeriodMs: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Kill all orphan Mneme processes", args: { dryRun: false }, expectedOutput: "{ attempted, killed, failed, perPid: [...] }" }],
  pitfalls: ["dryRun=true first to confirm targets. Real reaping is irreversible."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const opts = {
      ...(args["dryRun"] ? { dryRun: true } : {}),
      ...(typeof args["gracePeriodMs"] === "number" ? { gracePeriodMs: args["gracePeriodMs"] as number } : {}),
      skipPid: process.pid,
    };
    const r = core.installOrgan.reapMnemeProcesses(opts);
    return {
      data: r,
      wisdom: `🪄 attempted ${r.attempted} · killed ${r.killed} · failed ${r.failed} · tombstones ${r.tombstonesRemoved}`,
      confidence: { level: "high" },
    };
  },
};

export const installLineageTool: MnemeTool = {
  name: "mneme.install.lineage",
  category: "audit",
  description: "🪄 INSTALL ORGAN — read the HMAC-chained spawn/exit lineage ledger. Composes with v2.19.34 APOSTILLE chain pattern. Returns chain integrity + recent events.",
  whenToUse: "Post-incident audit: 'which processes spawned + when? Who survived? Who was reaped?'.",
  triggers: ["install lineage", "process lineage", "spawn audit"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max events to return. Default 100." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show the spawn/exit history", args: { limit: 50 }, expectedOutput: "{ entries: [...], chainOk: true }" }],
  pitfalls: ["Lineage ledger lives in ~/.mneme-global/lineage.jsonl — shared across all repos on this machine."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 100;
    const entries = core.installOrgan.readLineage(limit);
    const chain = core.installOrgan.verifyLineage();
    return {
      data: { entries, chainOk: chain.ok, ...(chain.brokenAt !== undefined ? { brokenAt: chain.brokenAt, reason: chain.reason } : {}) },
      wisdom: chain.ok ? `🪄 ${entries.length} events · chain VERIFIED` : `🪄 ${entries.length} events · ⚠ chain broken at #${chain.brokenAt}: ${chain.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const installHeartbeatListTool: MnemeTool = {
  name: "mneme.install.heartbeat_list",
  category: "audit",
  description: "🪄 INSTALL ORGAN — list every Mneme process currently registered in the heartbeat dir (cross-repo, cross-platform). Each beat reports pid + role + parent + cwd + platform + age. Use to inspect 'who's alive right now'.",
  whenToUse: "Diagnostics / dashboard. Or before reaping — confirm the set of PIDs you'd kill.",
  triggers: ["heartbeat list", "list mneme processes"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which Mneme processes are alive?", args: {}, expectedOutput: "{ heartbeats: [{pid,role,ageMs,status}, ...] }" }],
  pitfalls: ["A stale-but-alive heartbeat (age > 15s but PID alive) often means an orphaned daemon child."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const classified = core.installOrgan.classifyHeartbeats();
    return {
      data: { heartbeats: classified, total: classified.length },
      wisdom: `🪄 ${classified.length} process(es) · ${classified.filter((b) => b.status === "alive").length} alive · ${classified.filter((b) => b.status === "stale-but-alive").length} stale · ${classified.filter((b) => b.status === "tombstone").length} tombstone`,
      confidence: { level: "high" },
    };
  },
};

// ────────────────────────────────────────────────────────────────────────
// v2.19.54 — PREDICTIVE INSTALL SIGNAL + UPGRADE PIPELINE (new MCP tools)
// ────────────────────────────────────────────────────────────────────────

export const installAnnounceTool: MnemeTool = {
  name: "mneme.install.announce",
  category: "lab",
  description: "🪄 INSTALL ORGAN v2.19.54 — announce an INCOMING install. Writes ~/.mneme-global/install-incoming.flag which all running Mneme daemons fs.watch. Daemons see it within ~50ms and SELF-REAP cleanly via their SIGTERM handler. ZERO orphan because daemon dies BEFORE npm extracts. The wild predictive-signal innovation.",
  whenToUse: "Just before invoking `npm install -g mneme-ai@latest` programmatically. Or from a CI pipeline. Pair with mneme.install.upgrade_pipeline for the full magical experience.",
  triggers: ["install announce", "announce upgrade"],
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Free-form text for the lineage ledger (e.g. 'ci-pipeline', 'user-requested')." },
      expectedVersion: { type: "string", description: "Optional: target version we're installing (recorded in the flag for audit)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Tell daemons to step aside, install coming", args: { reason: "user-upgrade", expectedVersion: "2.19.54" }, expectedOutput: "{ flagPath, announced: true }" }],
  pitfalls: ["Must call mneme.install.clear_announce AFTER install completes — otherwise daemons will refuse to restart on next CLI command."],
  composeWith: ["mneme.install.upgrade_pipeline", "mneme.install.heal"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reason = (args["reason"] as string | undefined) ?? "ai-agent-call";
    const expectedVersion = args["expectedVersion"] as string | undefined;
    const flagPath = core.installOrgan.announceInstallIncoming(reason, expectedVersion);
    return {
      data: { announced: true, flagPath, reason, expectedVersion: expectedVersion ?? null },
      wisdom: `🪄 install-incoming announced (${reason}) — daemons watching ~/.mneme-global/ will self-reap within ~50ms`,
      confidence: { level: "high" },
    };
  },
};

export const installClearAnnounceTool: MnemeTool = {
  name: "mneme.install.clear_announce",
  category: "lab",
  description: "🪄 INSTALL ORGAN — clear the install-incoming flag after install completes. Allows daemons to respawn on next CLI command. Idempotent — safe to call if flag already cleared.",
  whenToUse: "After `npm install -g` completes (success or failure). Pair with mneme.install.announce.",
  triggers: ["install clear announce", "clear install flag"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Install done, clear the flag", args: {}, expectedOutput: "{ cleared: true }" }],
  pitfalls: ["If flag is not cleared, autonomic_breath_hook will throttle daemon respawns indefinitely."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    core.installOrgan.clearInstallIncoming();
    return { data: { cleared: true }, wisdom: `🪄 install-incoming flag cleared — daemons may respawn`, confidence: { level: "high" } };
  },
};

export const installUpgradePipelineTool: MnemeTool = {
  name: "mneme.install.upgrade_pipeline",
  category: "lab",
  description: "🪄✨ INSTALL ORGAN v2.19.54 — THE MAGICAL UPGRADE PIPELINE. One call composes: (1) announce install-incoming → (2) wait 300ms for daemons to self-reap → (3) full heal (diagnose+reap+reprobe) → (4) exponential-backoff retry loop (100ms→4s, 6 attempts) → (5) report ok/failure. Caller then runs `npm install -g --force mneme-ai@latest` with confidence. Cross-platform Windows + macOS + Linux.",
  whenToUse: "BEFORE any programmatic `npm install -g mneme-ai`. The one-call magic install. Also: when user reports EBUSY/ENOTEMPTY — call this first, retry npm install second.",
  triggers: ["upgrade pipeline", "magical install", "install ceremony"],
  inputSchema: {
    type: "object",
    properties: {
      installRoot: { type: "string", description: "Root dir to derive default probe paths." },
      probedPaths: { type: "array", items: { type: "string" }, description: "Explicit paths to probe (overrides default platform-aware list)." },
      expectedVersion: { type: "string" },
      reason: { type: "string" },
      waitForReapMs: { type: "number", description: "ms to wait for daemons to self-reap after announce. Default 300." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Prepare for the install with the full magical pipeline", args: { installRoot: "C:\\Users\\me\\AppData\\Roaming\\npm", expectedVersion: "2.19.54" }, expectedOutput: "{ ok, stages: {announce, waitForSelfReap, heal, backoff}, recommendation }" }],
  pitfalls: [
    "After ok=true, you STILL need to run npm install separately — this tool only PREPARES the environment.",
    "Call mneme.install.clear_announce after install completes (success or failure) to unblock future daemon respawns.",
  ],
  composeWith: ["mneme.install.announce", "mneme.install.heal", "mneme.install.clear_announce"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const paths = (args["probedPaths"] as string[] | undefined)
      ?? core.installOrgan.defaultLockableProbes(args["installRoot"] as string | undefined);
    const opts = {
      ...(typeof args["waitForReapMs"] === "number" ? { waitForReapMs: args["waitForReapMs"] as number } : {}),
      ...(args["expectedVersion"] ? { expectedVersion: args["expectedVersion"] as string } : {}),
      ...(args["reason"] ? { reason: args["reason"] as string } : {}),
      skipPid: process.pid,
    };
    const r = core.installOrgan.runUpgradePipeline(paths, opts);
    return {
      data: r,
      wisdom: r.ok
        ? `🪄✨ MAGICAL — ${r.stages.backoff.attempts} backoff(s) · ${r.stages.backoff.totalWaitMs}ms wait · all locks released`
        : `🪄⚠ pipeline incomplete — ${r.recommendation}`,
      confidence: { level: "high" },
    };
  },
};

export const V1953_INSTALL_ORGAN_TOOLS: MnemeTool[] = [
  installDiagnoseTool,
  installHealTool,
  installReapOrphansTool,
  installLineageTool,
  installHeartbeatListTool,
  installAnnounceTool,
  installClearAnnounceTool,
  installUpgradePipelineTool,
];

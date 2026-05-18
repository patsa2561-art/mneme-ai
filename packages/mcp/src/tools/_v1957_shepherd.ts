/**
 * v2.19.57 SHEPHERD MCP — the dream organ exposed to AI agents.
 *
 *   mneme.shepherd.start          — spawn detached shepherd for self-upgrade
 *   mneme.shepherd.status         — read HMAC-chained state ledger
 *   mneme.shepherd.cancel         — release lock + clear incoming flag (emergency)
 *
 * The user-facing magic: AI agent calls `mneme.shepherd.start({target:"latest"})`,
 * Mneme detaches a shepherd, reaps itself, npm-installs --omit=optional, spawns
 * new daemon — all automatically. AI agent polls `mneme.shepherd.status` until
 * `lastVerdict === "complete"`. Zero user intervention.
 *
 * 8th world-first: no AI tool ships a callable self-installing pipeline via MCP.
 */

import type { MnemeTool } from "./_types.js";
import { spawn } from "node:child_process";

export const shepherdStartTool: MnemeTool = {
  name: "mneme.shepherd.start",
  category: "lab",
  description: "🔮✨ DREAM ORGAN — spawn a DETACHED shepherd process that self-upgrades Mneme automatically. Pipeline: announce-incoming → wait → reap survivors → npm install -g --omit=optional --force mneme-ai@<target> → verify → spawn new daemon → clear flag. Returns immediately with shepherd PID; AI agent polls mneme.shepherd.status until complete. Parallel-safe (lock-protected). Cross-platform Windows + macOS + Linux.",
  whenToUse: "User asks 'upgrade Mneme' or 'install latest' or hits EBUSY repeatedly. The dream-organ alternative to `npm install -g mneme-ai@latest` which races daemon.",
  triggers: ["shepherd start", "self upgrade", "auto upgrade mneme", "dream organ upgrade"],
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "npm dist-tag or version (default: 'latest'). Examples: 'latest', '2.19.57', '@beta'." },
      secret: { type: "string", description: "Optional HMAC secret override (default: env MNEME_SHEPHERD_SECRET or built-in)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Upgrade Mneme automatically", args: { target: "latest" }, expectedOutput: "{ ok: true, shepherdPid, scriptPath, target }" }],
  pitfalls: [
    "Calling this when a shepherd is already running returns ok=false reason='shepherd-already-running' — check mneme.shepherd.status for current state.",
    "The shepherd will REAP this MCP server's daemon too — the AI session may need to reconnect after the upgrade completes.",
    "If the host machine has no `npm` on PATH, the shepherd will fail at npm-install-start step.",
  ],
  composeWith: ["mneme.shepherd.status", "mneme.install.upgrade_pipeline"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const target = (args["target"] as string) ?? "latest";
    const secret = (args["secret"] as string) ?? process.env["MNEME_SHEPHERD_SECRET"] ?? `mneme-shepherd-v${core.shepherd.PROTOCOL_VERSION}`;

    // Extract shepherd script
    const scriptPath = core.shepherd.installShepherdScript();

    // Try to acquire lock (fail fast if another shepherd running)
    const lockResult = core.shepherd.acquireShepherdLock(target, "starting", secret);
    if (!lockResult.acquired && lockResult.reason === "already-running") {
      return {
        data: { ok: false, reason: "shepherd-already-running", otherShepherd: lockResult.otherShepherd },
        wisdom: `🔮 shepherd already running (PID ${lockResult.otherShepherd.pid}, target ${lockResult.otherShepherd.targetVersion})`,
        confidence: { level: "high" },
      };
    }
    if (!lockResult.acquired && lockResult.reason === "lock-write-failed") {
      return {
        data: { ok: false, reason: "lock-write-failed", error: lockResult.error },
        wisdom: `🔮 lock-write failed: ${lockResult.error}`,
        confidence: { level: "low" },
      };
    }
    // Stale-lock-cleared → retry once
    if (!lockResult.acquired && lockResult.reason === "stale-lock-cleared") {
      const retry = core.shepherd.acquireShepherdLock(target, "starting", secret);
      if (!retry.acquired) {
        return {
          data: { ok: false, reason: "lock-retry-failed", details: retry },
          wisdom: `🔮 lock retry failed: ${JSON.stringify(retry)}`,
          confidence: { level: "low" },
        };
      }
    }
    // Release the lock — shepherd will reacquire it fresh
    core.shepherd.releaseShepherdLock();

    // Spawn the detached shepherd
    const spawnArgs = [
      scriptPath,
      "--target", target,
      "--state-path", core.shepherd.shepherdStatePath(),
      "--lock-path", core.shepherd.shepherdLockPath(),
      "--secret", secret,
    ];
    try {
      const child = spawn(process.execPath, spawnArgs, {
        detached: true, stdio: "ignore", windowsHide: true,
      });
      if (child.unref) child.unref();
      return {
        data: { ok: true, shepherdPid: child.pid, scriptPath, target },
        wisdom: `🔮 shepherd started (PID ${child.pid}, target ${target}) — poll mneme.shepherd.status for progress`,
        confidence: { level: "high" },
      };
    } catch (e) {
      return {
        data: { ok: false, reason: "spawn-failed", error: (e as Error).message },
        wisdom: `🔮 spawn failed: ${(e as Error).message}`,
        confidence: { level: "low" },
      };
    }
  },
};

export const shepherdStatusTool: MnemeTool = {
  name: "mneme.shepherd.status",
  category: "audit",
  description: "🔮 DREAM ORGAN — read the HMAC-chained shepherd state ledger. Returns {running, currentLock, lastEvents, lastVerdict, chainOk}. Poll this after mneme.shepherd.start until lastVerdict ∈ {complete, failed}.",
  whenToUse: "After mneme.shepherd.start. Periodic progress check. Post-incident audit.",
  triggers: ["shepherd status", "upgrade status"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max events to return. Default 20." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the upgrade done?", args: { limit: 5 }, expectedOutput: "{ running, lastVerdict, lastEvents: [...] }" }],
  pitfalls: ["State ledger is append-only; old entries persist. Use limit to bound response size."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 20;
    const s = core.shepherd.shepherdStatus(limit);
    return {
      data: s,
      wisdom: s.running
        ? `🔮 RUNNING · ${s.currentLock?.step ?? "unknown"} · target ${s.lastTargetVersion}`
        : `🔮 ${s.lastVerdict.toUpperCase()}${s.lastCompleteAt ? ` at ${s.lastCompleteAt}` : ""} · chain ${s.chainOk ? "OK" : "BROKEN"}`,
      confidence: { level: "high" },
    };
  },
};

export const shepherdCancelTool: MnemeTool = {
  name: "mneme.shepherd.cancel",
  category: "lab",
  description: "🔮 DREAM ORGAN — emergency stop. Releases shepherd lock + clears install-incoming flag. Use ONLY if a shepherd is stuck or you need to abort. Does NOT kill an in-flight `npm install` — npm has its own timeout.",
  whenToUse: "Shepherd is stuck at the same step for >10 minutes. Or user wants to abort the upgrade.",
  triggers: ["shepherd cancel", "abort upgrade"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Cancel the upgrade", args: {}, expectedOutput: "{ lockReleased, flagCleared }" }],
  pitfalls: ["This does NOT kill an in-flight npm install. If npm install is the stuck step, kill it manually."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const lockReleased = core.shepherd.releaseShepherdLock();
    let flagCleared = false;
    try {
      core.installOrgan.clearInstallIncoming();
      flagCleared = true;
    } catch { /* */ }
    return {
      data: { lockReleased, flagCleared },
      wisdom: `🔮 cancelled · lock=${lockReleased} flag=${flagCleared}`,
      confidence: { level: "high" },
    };
  },
};

export const V1957_SHEPHERD_TOOLS: MnemeTool[] = [
  shepherdStartTool,
  shepherdStatusTool,
  shepherdCancelTool,
];

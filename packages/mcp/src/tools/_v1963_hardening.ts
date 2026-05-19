/**
 * v2.19.63 PHOENIX HARDENING MCP TOOLS — 4 callable surfaces.
 *
 *   mneme.install.trail           — read HMAC-chained preinstall trail
 *   mneme.install.trail_verify    — verify chain integrity
 *   mneme.doctor.scan             — scan all npm prefixes for mneme installs
 *   mneme.phoenix.extract_status  — diagnose whether DLL extraction fired
 *
 * Wire-up reason: v2.19.62 install path "passed" only because the daemon
 * happened to die from an unrelated watchdog (NOT because PHOENIX P3
 * fired). User correctly demanded forensic proof. These 4 tools expose
 * that proof to AI agents + CI gates.
 */

import type { MnemeTool } from "./_types.js";

export const installTrailTool: MnemeTool = {
  name: "mneme.install.trail",
  category: "audit",
  description: "📜 PHOENIX HARDENING — read the HMAC-chained preinstall trail at ~/.mneme-global/preinstall-trail.jsonl. Shows the most-recent complete install (preinstall-start → end) or the tail. Use to PROVE preinstall hook actually ran.",
  whenToUse: "After install: 'did preinstall actually fire?' Before claiming an install fix worked: read the trail + verify chain. User reports stale install behavior: trail shows the last attempt + step outcomes.",
  triggers: ["install trail", "preinstall history", "did preinstall run", "install evidence"],
  inputSchema: {
    type: "object",
    properties: {
      recentOnly: { type: "boolean", description: "If true, return only the most-recent install block (from last preinstall-start). Default true." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show preinstall history", args: { recentOnly: true }, expectedOutput: "{ entries: [{step:'preinstall-start',ok:true,ts:...}, ...], summary: {attempts,completed,chainOk} }" }],
  pitfalls: [
    "Trail is per-user (~/.mneme-global). Cross-user installs invisible to each other.",
    "If trail file is missing, preinstall NEVER ran (or this is a fresh machine).",
  ],
  composeWith: ["mneme.install.trail_verify", "mneme.doctor.scan"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const recentOnly = args["recentOnly"] !== false;
    const entries = recentOnly ? core.preinstallTrail.recentInstall() : core.preinstallTrail.readTrail();
    const summary = core.preinstallTrail.summarize();
    return {
      data: { entries, summary, trailPath: core.preinstallTrail.trailPath() },
      wisdom: entries.length === 0
        ? "📜 trail is empty — preinstall hook has never run on this machine (or was cleared)"
        : `📜 ${entries.length} entry/entries · ${summary.completedInstalls}/${summary.installAttempts} installs completed · chain ${summary.chainOk ? "ok" : "BROKEN"} · last: ${summary.lastInstallVersion ?? "?"} ${summary.lastInstallOk ? "ok" : "FAIL"}`,
      confidence: { level: summary.chainOk ? "high" : "low" },
    };
  },
};

export const installTrailVerifyTool: MnemeTool = {
  name: "mneme.install.trail_verify",
  category: "audit",
  description: "📜 PHOENIX HARDENING — verify HMAC chain integrity of preinstall trail. Returns the broken-at index + reason if tampered. The 'is my install evidence trustworthy?' question.",
  whenToUse: "Before trusting any trail-based claim. CI gate on every install (post-install hook reads trail + verifies). Security audit.",
  triggers: ["verify install trail", "trail integrity", "preinstall chain ok"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the install trail tampered?", args: {}, expectedOutput: "{ chainOk: true, totalEntries: 14, hasCompleteInstall: true }" }],
  pitfalls: ["Returns chainOk=true on empty trail (vacuously true). Use mneme.install.trail to check if entries exist first."],
  composeWith: ["mneme.install.trail", "mneme.phoenix.sentinel_probe"],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const r = core.preinstallTrail.verifyTrail();
    return {
      data: r,
      wisdom: r.totalEntries === 0
        ? "📜 trail empty — vacuously ok (preinstall has never run)"
        : r.chainOk
        ? `📜 chain ok · ${r.totalEntries} entry/entries · complete-install=${r.hasCompleteInstall}`
        : `📜 ⚠ chain BROKEN at index ${r.brokenAtIndex}: ${r.brokenReason}`,
      confidence: { level: r.chainOk ? "high" : "low" },
    };
  },
};

export const doctorScanTool: MnemeTool = {
  name: "mneme.doctor.scan",
  category: "audit",
  description: "🩺 PHOENIX HARDENING — scan ALL npm prefixes on this machine (NVM4W + nvm-windows + Volta + system Node + npm config get prefix) for mneme-ai installations. Identifies dual-install conflicts, version drift, PATH ambiguity. Returns exact remediation commands.",
  whenToUse: "User reports 'mneme version is wrong' or 'I upgraded but it still shows old version'. Suspected PATH shim conflict. After installing via a Node version manager switch.",
  triggers: ["mneme doctor", "scan installs", "dual install", "which mneme", "find all mneme"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Are there multiple mneme installs?", args: {}, expectedOutput: "{ installs: [...], hasConflict: true, activeInstall: {...}, recommendations: ['CONFLICT: 2 installs detected...', 'To remove stale...'] }" }],
  pitfalls: [
    "Calls `npm config get prefix` (subprocess) — adds ~500ms latency. Cache the result if calling repeatedly.",
    "Detection is best-effort across known managers; exotic setups (chocolatey, custom paths) may slip through.",
    "NEVER deletes anything — pure observation. Recommendations are commands FOR the user, not auto-executed.",
  ],
  composeWith: ["mneme.install.trail", "mneme.phoenix.extract_status"],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const r = core.doctor.runDoctorCycle();
    return {
      data: r,
      wisdom: r.hasConflict
        ? `🩺 ⚠ CONFLICT · ${r.installs.length} installs across ${r.prefixesScanned.length} npm prefix/prefixes · versions: ${r.versionsFound.join(", ")} · active: ${r.activeInstall?.packagePath ?? "none"}`
        : r.installs.length === 1
        ? `🩺 healthy · 1 install (${r.installs[0]!.version}) at ${r.installs[0]!.npmPrefix}`
        : "🩺 no mneme-ai installation detected",
      confidence: { level: "high" },
    };
  },
};

export const phoenixExtractStatusTool: MnemeTool = {
  name: "mneme.phoenix.extract_status",
  category: "audit",
  description: "🔥 PHOENIX HARDENING — diagnose whether the v2.19.62 P3 DLL extraction trick is currently active. Reads process.env[PATH/DYLD_LIBRARY_PATH/LD_LIBRARY_PATH] for the per-PID mneme-vips-{pid} entry. PROVES the daemon is using disjoint DLL paths (or isn't).",
  whenToUse: "Audit: is PHOENIX P3 firing in production? Diagnosis: 'why is EBUSY still happening?'. Verifies the daemon boot wiring v2.19.63 added.",
  triggers: ["phoenix extract status", "is dll extraction active", "verify p3 wiring"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is PHOENIX P3 active in this daemon?", args: {}, expectedOutput: "{ envVar: 'PATH', tmpDirInEnv: true, expectedTmpDir: 'C:\\...\\Temp\\mneme-vips-1234', dllExtracted: true }" }],
  pitfalls: [
    "Reports the CURRENT process state — for the daemon's state, call this from inside the daemon (MCP-via-daemon) not from a fresh CLI subprocess.",
    "tmpDirInEnv=false means daemon-boot extraction did NOT fire OR fired but failed.",
  ],
  composeWith: ["mneme.phoenix.extract_dll", "mneme.phoenix.dll_sweep", "mneme.install.trail"],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const envVar = core.phoenix.dllExtraction.dynamicLibraryEnvVar();
    const expectedTmpDir = core.phoenix.dllExtraction.pidTmpDir(process.pid);
    const envValue = process.env[envVar] ?? "";
    const tmpDirInEnv = envValue.includes(expectedTmpDir);
    const { existsSync } = await import("node:fs");
    const tmpDirExists = existsSync(expectedTmpDir);
    return {
      data: {
        v: 1,
        organ: "phoenix-extract-status",
        ts: new Date().toISOString(),
        envVar,
        envValue: envValue.slice(0, 500) + (envValue.length > 500 ? "..." : ""),
        expectedTmpDir,
        tmpDirInEnv,
        tmpDirExists,
        pid: process.pid,
        dllExtracted: tmpDirInEnv && tmpDirExists,
      },
      wisdom: tmpDirInEnv && tmpDirExists
        ? `🔥 P3 active · ${envVar} prepended with ${expectedTmpDir}`
        : !tmpDirInEnv
        ? `🔥 ⚠ P3 NOT active · ${envVar} does not contain expected tmpdir · check daemon-boot wiring or call mneme.phoenix.extract_dll manually`
        : `🔥 ⚠ ${envVar} contains tmpdir but actual dir is missing — extraction was reverted or never wrote files`,
      confidence: { level: tmpDirInEnv && tmpDirExists ? "high" : "low" },
    };
  },
};

export const V1963_HARDENING_TOOLS: MnemeTool[] = [
  installTrailTool,
  installTrailVerifyTool,
  doctorScanTool,
  phoenixExtractStatusTool,
];

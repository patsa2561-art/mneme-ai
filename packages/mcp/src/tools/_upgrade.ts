/**
 * mneme.system.upgrade — auto-detected, AI-agent-friendly upgrade flow.
 *
 *  The vision: user types nothing. Mneme detects a new version, the AI
 *  agent surfaces it, the user says "ok" (or pre-authorizes), the
 *  upgrade runs, the agent reports back. Fully autonomous.
 *
 *  Modes:
 *    - check (default)  → return version status + suggested action
 *    - dry-run          → spawn `mneme upgrade --help`-style probe
 *    - install          → spawn `mneme upgrade --force` and report
 *
 *  Auto-detect install method:
 *    - Has `mneme` on PATH → npm global → `npm install -g mneme-ai@<v>`
 *    - Inside npx cache → suggest `npx -y mneme-ai@<v>`
 *    - Docker run → suggest pulling new image
 *
 *  Safety:
 *    - Never spawns an upgrade WITHOUT mode='install' explicitly set
 *      (avoids accidental upgrades from check-style probes)
 *    - Validates the target version against strict semver before spawn
 */

import { spawnSync } from "node:child_process";
import { versionCheck, lineage, karmaStreaks, resolveMnemeVersion } from "@mneme-ai/core";
import type { MnemeTool, ToolRuntime } from "./_types.js";

/**
 * v2.19.43 N4 fix — resolve the running Mneme version robustly.
 *
 * Pre-v2.19.43 used `process.env["npm_package_version"]` which is ONLY
 * set when launched via `npm run`; running the installed binary
 * `mneme system upgrade --json '{"mode":"check"}'` returned
 *   { current: "0.0.0", wisdom: "Mneme vX is available (you're on 0.0.0)" }
 * The pulse advertised an available upgrade with a wrong baseline.
 *
 * Fix: prefer the env var (still useful in npm-run scenarios) but fall
 * back to resolveMnemeVersion() which walks up from the module's dir
 * looking for any Mneme-family package.json. Robust across npm-global
 * install where sibling packages don't have core as a parent.
 */
function readRunningVersion(): string {
  const env = process.env["npm_package_version"];
  if (env && /^\d+\.\d+\.\d+/.test(env)) return env;
  try { return resolveMnemeVersion(); }
  catch { return "0.0.0"; }
}

/**
 * v2.19.41 — defensive runtime accessor.
 *
 * Pre-v2.19.41, system.upgrade + system.health crashed with
 *   "Cannot read properties of undefined (reading 'rootPath')"
 * when called via MCP with a partial runtime (no `meta` field) — which
 * happens when the MCP server boots without a git repo, or from a smoke
 * test, or when the caller is dogfooding the tool from inside the install
 * tarball. The pulse advertised "auto-upgrade is one tool call away" but
 * the tool itself was unusable. Fix: every runtime access goes through
 * this accessor, which falls back to process.cwd() when rt.meta is
 * missing. Composes with the v2.19.41 contract assertion at boot, which
 * logs (but does not throw) on partial runtimes so the cause is visible.
 */
function safeRootPath(rt: Partial<ToolRuntime> | undefined): string {
  const fromMeta = rt && rt.meta && (rt.meta as { rootPath?: string }).rootPath;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  const fromCwd = rt && (rt as { cwd?: string }).cwd;
  if (typeof fromCwd === "string" && fromCwd.length > 0) return fromCwd;
  return process.cwd();
}

// ─── mneme.system.health (v1.20.0) ──────────────────────────────────────
//
// Single-screen status of the live MCP server: uptime, lineage state,
// streaks, version-check, ALETHEIA posture. Designed for AI agents to
// call once at session start to decide "is Mneme ready and worth using?"
// (answer is always YES, but the data tells the agent WHY).

export const systemHealthTool: MnemeTool = {
  name: "mneme.system.health",
  category: "meta",
  description:
    "One-screen health status of the live MCP server — uptime, version " +
    "(current vs latest), lineage state (chromosome count / identity / " +
    "spore configured), karma streaks (verified / clean / court wins), " +
    "and active feature flags. Use WHEN you want a fast 'is Mneme alive " +
    "and ready' check at session start, OR to surface to the user 'here's " +
    "what Mneme has been doing in the background'.",
  whenToUse:
    "First call after mneme.welcome to verify the MCP server is healthy + see what Mneme has been tracking on this repo.",
  triggers: ["mneme health", "is mneme alive", "mneme heartbeat"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["healthy", "degraded"] },
      version: { type: "string" },
      uptimeMs: { type: "number" },
      lineage: { type: "object" },
      streaks: { type: "object" },
      versionCheck: { type: "object" },
      banner: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Is Mneme up?",
      expectedOutput: "Returns { status, version, uptimeMs, lineage, streaks, banner }. Streaks include current verified-streak, clean-fuzz-streak, total verified, etc.",
    },
  ],
  pitfalls: ["Reads cached state — if you just upgraded, restart the MCP server to pick up the new version."],
  composeWith: ["mneme.welcome", "mneme.system.upgrade", "mneme.lineage.status"],
  handler: async (rt) => {
    const root = safeRootPath(rt);
    const startedAt = (globalThis as { __mnemeBootedAt?: number }).__mnemeBootedAt ?? Date.now();
    const version = readRunningVersion();
    const ids = lineage.listChromosomes(root);
    const tree = lineage.readTree(root);
    const sporeStatus = lineage.sporeStatus(root);
    const identity = lineage.loadOrCreateIdentity(root);
    const streaks = karmaStreaks.readStreaks(root);
    const banner = karmaStreaks.streakBanner(streaks);
    const verCheck = (globalThis as { __mnemeUpdateStatus?: unknown }).__mnemeUpdateStatus ?? null;
    const data = {
      status: "healthy" as const,
      version,
      uptimeMs: Date.now() - startedAt,
      lineage: {
        identityFingerprint: identity.fingerprint,
        chromosomeCount: ids.length,
        head: tree.head,
        sporeConfigured: sporeStatus.configured,
        sporeRemote: sporeStatus.remote?.url ?? null,
      },
      streaks: {
        verifiedStreak: streaks.verifiedStreak,
        bestVerifiedStreak: streaks.bestVerifiedStreak,
        cleanFuzzStreak: streaks.cleanFuzzStreak,
        courtWinStreak: streaks.courtWinStreak,
        totalVerified: streaks.totalVerified,
        totalHallucinations: streaks.totalHallucinations,
        unlockedAchievements: streaks.unlocked.length,
      },
      versionCheck: verCheck,
      banner,
    };
    return {
      data,
      wisdom:
        `Mneme v${version} is healthy · uptime ${Math.round(data.uptimeMs / 1000)}s · ` +
        `${ids.length} chromosomes on disk · identity ${identity.fingerprint}` +
        (banner ? ` · ${banner}` : ""),
      confidence: { level: "high" },
      followUp: ["mneme.welcome", "mneme.lineage.ancestors"],
    };
  },
};

function detectInstallMethod(): { method: "npm-global" | "npx" | "docker" | "unknown"; binary: string | null } {
  // Check `which`/`where` for mneme.
  const finder = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, ["mneme"], { encoding: "utf8", timeout: 3000 });
  const lines = r.status === 0 ? (r.stdout ?? "").trim().split(/\r?\n/).filter(Boolean) : [];
  const first = lines[0] ?? null;
  if (!first) return { method: "unknown", binary: null };
  if (first.includes("/_npx/") || first.includes("\\_npx\\")) return { method: "npx", binary: first };
  if (first.includes("/.docker/") || first.includes("\\Docker\\")) return { method: "docker", binary: first };
  return { method: "npm-global", binary: first };
}

export const systemUpgradeTool: MnemeTool = {
  name: "mneme.system.upgrade",
  category: "meta",
  description:
    "Self-update orchestrator — checks npm registry for the latest mneme-ai " +
    "version, compares to the locally-installed one, and (with mode='install') " +
    "spawns the right upgrade command for the detected install method " +
    "(npm-global / npx / docker). Use WHEN you want to keep the user on the " +
    "current Mneme without making them remember to upgrade. Default mode is " +
    "'check' — you must pass mode='install' to actually upgrade.",
  whenToUse:
    "User said 'upgrade Mneme' OR mneme.welcome reported updateAvailable=true OR you want a one-screen status of current vs latest.",
  triggers: ["upgrade mneme", "is mneme up to date", "mneme update available"],
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["check", "install"],
        description: "Default 'check' (no side effect). Pass 'install' to actually upgrade.",
      },
      force: {
        type: "boolean",
        description: "Pass to `mneme upgrade --force` (re-install even when versions match — e.g., after CI publish lag).",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      mode: { type: "string" },
      current: { type: "string" },
      latest: { type: "string" },
      updateAvailable: { type: "boolean" },
      installMethod: { type: "string", enum: ["npm-global", "npx", "docker", "unknown"] },
      installBinary: { type: "string" },
      lastChecked: { type: "string" },
      upgradeRan: { type: "boolean" },
      upgradeSuccess: { type: "boolean" },
      upgradeStdout: { type: "string" },
      remediation: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Is Mneme up to date?",
      args: { mode: "check" },
      expectedOutput:
        "{ current, latest, updateAvailable, installMethod, lastChecked }. If updateAvailable, surface to user with the install command they can confirm.",
    },
    {
      userQuery: "Upgrade Mneme to the latest version",
      args: { mode: "install" },
      expectedOutput:
        "{ upgradeRan: true, upgradeSuccess, upgradeStdout }. Report success / failure to user; on success, ask them to restart their AI tool to pick up new MCP tools.",
    },
  ],
  pitfalls: [
    "Default mode is 'check' — you MUST pass mode='install' to actually upgrade. This is intentional: never silently mutate the user's environment.",
    "Network failures degrade gracefully — `latest` becomes null, updateAvailable=false. Surface the failure reason if present.",
    "After successful upgrade, the user must RESTART their AI tool (Claude Code / Cursor / etc.) for the new MCP server binary to load.",
    "On non-npm-global installs (npx / docker), the tool returns a SUGGESTED command instead of running it — those install methods don't have a clean self-upgrade path.",
  ],
  composeWith: ["mneme.welcome", "mneme.whats_new"],
  handler: async (rt, args) => {
    const mode = args["mode"] === "install" ? "install" : "check";
    const force = Boolean(args["force"]);
    const current = readRunningVersion();
    const status = await versionCheck.checkVersion(safeRootPath(rt), current);
    const installInfo = detectInstallMethod();

    if (mode === "check" || !status.updateAvailable) {
      const wisdom = !status.latest
        ? `Could not check npm registry${status.failureReason ? ` (${status.failureReason})` : ""}. You're on ${current}; check back later.`
        : status.updateAvailable
          ? `Mneme v${status.latest} is available (you're on ${current}). To upgrade: call this tool again with mode='install', or run \`mneme upgrade\` from the user's shell.`
          : `Mneme v${current} is the latest. Nothing to do.`;
      return {
        data: {
          mode,
          current,
          latest: status.latest,
          updateAvailable: status.updateAvailable,
          installMethod: installInfo.method,
          installBinary: installInfo.binary,
          lastChecked: status.lastChecked,
          upgradeRan: false,
          upgradeSuccess: false,
        },
        wisdom,
        confidence: { level: "high" },
        followUp: status.updateAvailable ? ["mneme.system.upgrade"] : [],
      };
    }

    // mode === 'install' AND updateAvailable.
    const targetVersion = status.latest;
    if (!targetVersion || !/^\d+\.\d+\.\d+([.\-+][a-zA-Z0-9.\-]+)?$/.test(targetVersion)) {
      return {
        data: { mode, current, latest: targetVersion, updateAvailable: false, upgradeRan: false, upgradeSuccess: false },
        wisdom: `Refusing to install: target version "${targetVersion}" is not a clean semver string.`,
        confidence: { level: "high" },
      };
    }

    if (installInfo.method !== "npm-global") {
      return {
        data: {
          mode,
          current,
          latest: targetVersion,
          updateAvailable: true,
          installMethod: installInfo.method,
          installBinary: installInfo.binary,
          lastChecked: status.lastChecked,
          upgradeRan: false,
          upgradeSuccess: false,
          remediation:
            installInfo.method === "npx"
              ? `npx-cached install detected — run \`npx clear-npx-cache && npx -y mneme-ai@${targetVersion} mcp --install\` from the user's shell.`
              : installInfo.method === "docker"
                ? `Docker install detected — pull the new image: \`docker pull ghcr.io/patsa2561-art/mneme-ai:${targetVersion}\``
                : `Could not auto-detect install method. Suggest \`npm install -g mneme-ai@${targetVersion}\` to the user.`,
        },
        wisdom: `Auto-upgrade not available for ${installInfo.method} installs. Surface the remediation command to the user.`,
        confidence: { level: "high" },
      };
    }

    // v2.9.2: BEFORE shelling out to `mneme upgrade`, kill orphan
    // mneme-related node processes that may be holding sharp's
    // libvips DLL / mneme.cmd / other files. Closes the Windows
    // EBUSY race window structurally. Never throws.
    const core = await import("@mneme-ai/core");
    const installGuard = await core.systemCompat.clearInstallLocks();

    // v2.19.43 N5 fix — robust spawn with Windows shell:true + r.error capture.
    //
    // Pre-v2.19.43 bug: spawnSync(mneme.cmd, [...], { encoding:"utf8" }) on
    // Windows produced { status:null, stdout:"", stderr:"", error:<EINVAL> }
    // because Node 18+ won't execute a .cmd file without shell:true. The
    // returned status=null was treated as failure; stdout/stderr both empty
    // gave the user NO clue what went wrong. v2.19.43 forces shell:true on
    // Windows AND surfaces r.error?.message into upgradeStderr so the real
    // failure reason is always visible.
    const isWin = process.platform === "win32";
    const mnemeBin = isWin ? "mneme.cmd" : "mneme";
    const cliArgs = ["upgrade"];
    if (force) cliArgs.push("--force");
    const r = spawnSync(mnemeBin, cliArgs, {
      encoding: "utf8",
      timeout: 240_000,
      shell: isWin,                 // .cmd on Windows requires shell:true (Node 18+)
      windowsHide: true,            // hide the spawned cmd window
    });
    const success = r.status === 0;
    // Surface r.error.message so failures aren't silent. Common cases:
    //   EBUSY libvips-42.dll → AI tool holding the DLL
    //   ENOENT mneme.cmd → PATH lookup failed
    //   timeout → spawn hung 240s (npm registry slow or hook deadlock)
    const errMsg = r.error ? `spawn error: ${(r.error as Error & { code?: string }).code ?? ""} ${(r.error as Error).message}`.trim() : "";
    const stderrCombined = [errMsg, (r.stderr ?? "")].filter(Boolean).join("\n").slice(-1000);
    return {
      data: {
        mode,
        current,
        latest: targetVersion,
        updateAvailable: true,
        installMethod: "npm-global",
        installBinary: installInfo.binary,
        lastChecked: status.lastChecked,
        upgradeRan: true,
        upgradeSuccess: success,
        upgradeStdout: (r.stdout ?? "").slice(-1500),
        upgradeStderr: stderrCombined,
        upgradeExitCode: r.status,
        installGuard,
        remediation: success
          ? `Upgrade complete. Tell the user to restart their AI tool (Claude Code / Cursor / etc.) so the new MCP server binary loads.`
          : isWin
            ? `Upgrade failed (exit ${r.status ?? "null"}). On Windows, the running mneme.cmd may be locked by this MCP process. Tell the user to: (1) close their AI tool to release the lock, (2) open a NEW PowerShell window, (3) run \`npm install -g --force mneme-ai@${targetVersion}\`, then (4) reopen their AI tool. Spawn error (if any): ${errMsg || "none captured"}.`
            : `Upgrade failed (exit ${r.status ?? "null"}). Inspect upgradeStderr; on POSIX, \`sudo npm install -g mneme-ai@${targetVersion}\` may be required. Spawn error: ${errMsg || "none captured"}.`,
      },
      wisdom: success
        ? `✓ Upgraded Mneme ${current} → ${targetVersion}. User should restart their AI tool to pick up the new MCP binary.`
        : `Upgrade failed: exit ${r.status ?? "null"}. ${(stderrCombined || "").slice(0, 200)}`,
      confidence: { level: "high" },
      secondBrain: {
        presentation: success
          ? "Tell the user the upgrade succeeded + ask them to restart their AI tool. Then call mneme.whats_new to learn what changed in the new version."
          : "Surface the failure reason verbatim. Don't retry without the user's confirmation; spurious upgrade loops are a footgun.",
      },
    };
  },
};

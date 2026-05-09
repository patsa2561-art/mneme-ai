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
import { versionCheck } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

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
    const current = process.env["npm_package_version"] ?? "0.0.0";
    const status = await versionCheck.checkVersion(rt.meta.rootPath, current);
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

    // Spawn `mneme upgrade --force` so the existing CLI handles the bulletproof
    // re-install + PATH diagnosis. Force ensures the version pin sticks even
    // if npm cache is stale.
    const mnemeBin = process.platform === "win32" ? "mneme.cmd" : "mneme";
    const cliArgs = ["upgrade"];
    if (force) cliArgs.push("--force");
    const r = spawnSync(mnemeBin, cliArgs, { encoding: "utf8", timeout: 240_000 });
    const success = r.status === 0;
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
        upgradeStderr: (r.stderr ?? "").slice(-500),
        remediation: success
          ? `Upgrade complete. Tell the user to restart their AI tool (Claude Code / Cursor / etc.) so the new MCP server binary loads.`
          : `Upgrade failed (exit ${r.status}). Inspect upgradeStderr; on POSIX, \`sudo npm install -g mneme-ai@${targetVersion}\` may be required.`,
      },
      wisdom: success
        ? `✓ Upgraded Mneme ${current} → ${targetVersion}. User should restart their AI tool to pick up the new MCP binary.`
        : `Upgrade failed: exit ${r.status}. ${(r.stderr ?? "").slice(0, 200)}`,
      confidence: { level: "high" },
      secondBrain: {
        presentation: success
          ? "Tell the user the upgrade succeeded + ask them to restart their AI tool. Then call mneme.whats_new to learn what changed in the new version."
          : "Surface the failure reason verbatim. Don't retry without the user's confirmation; spurious upgrade loops are a footgun.",
      },
    };
  },
};

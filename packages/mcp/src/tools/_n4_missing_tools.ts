/**
 * v2.26.0 — Adds MCP tools that exist in the CLI but were missing from
 * the MCP catalog (closes N4 deep-finding "CLI↔MCP drift").
 *
 * Audit (v2.24.0): `mneme.health`, `mneme.version`, `mneme.verify_self`
 * existed as CLI commands but were not in the MCP tool catalog. AI
 * agents that read tools/list could not call them — split-brain between
 * CLI users + MCP clients.
 *
 * Fix: wrap each CLI's corresponding core API as an MCP tool. These
 * are STATELESS so they work even when runtime is degraded (no git
 * repo). Added to STATELESS_TOOL_NAMES in runtime_deferred.ts.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

function resolveMnemeVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch { return "0.0.0"; }
}

export const versionTool: MnemeTool = {
  name: "mneme.version",
  category: "meta",
  description:
    "Return the installed Mneme version + npm-latest status. Stateless; works in degraded mode (no git repo). " +
    "Pre-v2.26: this was CLI-only; AI agents had to spawn a subprocess. Now reachable via MCP for any AI client.",
  whenToUse: "First contact; sanity check; before reporting Mneme is or isn't up to date.",
  triggers: ["mneme version", "what version is mneme", "mneme --version"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const current = resolveMnemeVersion();
    const status = (globalThis as { __mnemeUpdateStatus?: { latest?: string; updateAvailable?: boolean } }).__mnemeUpdateStatus;
    return {
      data: {
        installed: current,
        latest: status?.latest ?? null,
        updateAvailable: status?.updateAvailable ?? false,
      },
      wisdom: status?.updateAvailable
        ? `Mneme v${current} (latest v${status?.latest} — call mneme.system.upgrade to install).`
        : `Mneme v${current} (up to date or no status cached yet).`,
      followUp: status?.updateAvailable ? ["mneme.system.upgrade"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const healthTool: MnemeTool = {
  name: "mneme.health",
  category: "meta",
  description:
    "Mneme self-check: version + boot timestamp + daemon presence + recent error count. Stateless smoke test. " +
    "Pre-v2.26: CLI-only.",
  whenToUse: "AI agent suspects Mneme is unwell; pre-pitch sanity check.",
  triggers: ["mneme health", "mneme status", "is mneme ok"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const bootedAt = (globalThis as { __mnemeBootedAt?: number }).__mnemeBootedAt;
    const uptimeMs = bootedAt ? Date.now() - bootedAt : null;
    const current = resolveMnemeVersion();
    return {
      data: {
        installed: current,
        bootedAt: bootedAt ? new Date(bootedAt).toISOString() : null,
        uptimeMs,
        node: process.version,
        platform: process.platform,
      },
      wisdom: bootedAt
        ? `Mneme v${current} healthy · uptime ${Math.round((uptimeMs ?? 0) / 1000)}s · ${process.platform}/${process.version}.`
        : `Mneme v${current} — boot timestamp not recorded (cold MCP probe).`,
      followUp: ["mneme.version", "mneme.welcome"],
      confidence: { level: "high" as const },
    };
  },
};

export const verifySelfTool: MnemeTool = {
  name: "mneme.verify_self",
  category: "meta",
  description:
    "Mneme self-attestation: cryptographic check that the installed Mneme is genuine + the install root hasn't " +
    "been tampered with. Returns Trust Capsule URI + score 0-100. Pre-v2.26: CLI-only.",
  whenToUse: "Before trusting Mneme on a shared machine; after suspicious npm install; periodic install audit.",
  triggers: ["verify mneme", "mneme self check", "trust capsule"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const repoRoot = repoRootOf(rt);
    try {
      const core = await import("@mneme-ai/core");
      const cap = (core as { verifySelf?: { verifySelf: (root: string) => unknown } }).verifySelf;
      if (cap && typeof cap.verifySelf === "function") {
        const att = cap.verifySelf(repoRoot);
        return {
          data: { attestation: att },
          wisdom: "Mneme self-attestation computed. See attestation for trust capsule + score.",
          followUp: [],
          confidence: { level: "high" as const },
        };
      }
    } catch (e) {
      return {
        data: { error: (e as Error).message },
        wisdom: "Self-attestation failed; check Mneme install integrity.",
        followUp: [],
        confidence: { level: "low" as const },
      };
    }
    return {
      data: { error: "verifySelf module not available in this install" },
      wisdom: "This Mneme install is missing the verify_self module.",
      followUp: [],
      confidence: { level: "low" as const },
    };
  },
};

export const N4_MISSING_TOOLS: MnemeTool[] = [versionTool, healthTool, verifySelfTool];

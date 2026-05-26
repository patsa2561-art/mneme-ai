/**
 * v2.60.0 — SKELETON KEY MCP tool surface.
 *
 *   mneme.skeleton_key.audit       — full security audit of all configured MCP servers
 *   mneme.skeleton_key.recommend   — concrete config changes to reduce risk
 *   mneme.skeleton_key.pin         — HMAC-snapshot current config for drift detection
 *   mneme.skeleton_key.drift       — compare current vs pinned snapshot
 *   mneme.skeleton_key.probe       — empirically spawn ONE server + read tools/list
 *
 * Wraps core/src/skeleton_key/. AI agents use these tools to silently
 * audit the user's MCP setup before sensitive operations (e.g. on first
 * connect, after `mneme update`, or when the user asks "am I safe?").
 */

import type { MnemeTool } from "./_types.js";

export const skeletonKeyAuditTool: MnemeTool = {
  name: "mneme.skeleton_key.audit",
  category: "meta",
  description:
    "🦴 SKELETON KEY — full security audit of every MCP server configured across the user's IDEs (Claude Desktop / Cursor / Continue / Cline / Windsurf). Reports per-server risk score + CWE mapping + capability overlaps + transitive bypass graph (e.g. 'shell + filesystem + github = 3 ways to delete repo') + total risk budget. Empirical mode spawns each server to read its tools/list for ground-truth capabilities.",
  whenToUse:
    "User asks 'am I secure', 'audit my MCP setup', 'what risks do I have'; OR on first MCP connect to surface critical findings unprompted; OR after `mneme update` to detect new servers.",
  triggers: ["audit my mcp", "skeleton key", "mcp security audit", "what mcp servers"],
  inputSchema: {
    type: "object",
    properties: {
      budgetCap: { type: "number", description: "Risk budget cap (default 5.0). Audits flag OVER BUDGET when sum-severity-×-capability-count > cap." },
      empirical: { type: "boolean", description: "Spawn each MCP server + read tools/list for ground-truth capabilities (slow: ~1-2s per server). Default false." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = await core.skeletonKey.auditMcpConfigs({
        budgetCap: typeof args["budgetCap"] === "number" ? args["budgetCap"] as number : undefined,
        empiricalProbe: args["empirical"] === true,
      });
      const banner = core.skeletonKey.renderAuditBanner(r);
      return {
        data: r,
        wisdom: r.summary + "\n\n" + banner,
        followUp: r.ok ? [] : ["mneme.skeleton_key.recommend", "mneme.skeleton_key.pin"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const skeletonKeyRecommendTool: MnemeTool = {
  name: "mneme.skeleton_key.recommend",
  category: "meta",
  description:
    "🦴 SKELETON KEY — given an audit, emit concrete per-server config changes ordered by severity. Each recommendation includes the CWE id + the exact mitigation (e.g. 'scope token to specific repos; deny repo-creation'). Use this after `audit` finds high-severity items.",
  whenToUse: "User wants to fix what `audit` flagged.",
  triggers: ["how to fix my mcp", "skeleton key recommend"],
  inputSchema: { type: "object", properties: { budgetCap: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = await core.skeletonKey.auditMcpConfigs({
        budgetCap: typeof args["budgetCap"] === "number" ? args["budgetCap"] as number : undefined,
      });
      const recs = core.skeletonKey.buildRecommendations(r);
      return {
        data: { ok: recs.length === 0, count: recs.length, recommendations: recs },
        wisdom: recs.length === 0 ? "no actionable recommendations — setup is tight" : `${recs.length} recommendation(s) for ${recs.length} servers above 55% severity`,
        followUp: ["mneme.skeleton_key.pin"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "recommend failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const skeletonKeyPinTool: MnemeTool = {
  name: "mneme.skeleton_key.pin",
  category: "meta",
  description:
    "🦴 SKELETON KEY — snapshot the current MCP config (HMAC-signed) to `.mneme/skeleton_key/config_snapshot.json`. Future `drift` calls compare against this. Use after user has reviewed audit + accepts current setup.",
  whenToUse: "After audit + recommendations are reviewed; or once weekly to maintain a stable baseline.",
  triggers: ["pin mcp config", "skeleton key pin"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const snap = core.skeletonKey.pinConfigSnapshot(cwd);
      return {
        data: { ok: true, snapshot: snap },
        wisdom: `pinned ${snap.servers.length} server(s) at ${snap.at}`,
        followUp: ["mneme.skeleton_key.drift"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "pin failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const skeletonKeyDriftTool: MnemeTool = {
  name: "mneme.skeleton_key.drift",
  category: "meta",
  description:
    "🦴 SKELETON KEY — compare current MCP config vs pinned snapshot. Detects silent additions / removals / command-mutations. Critical: if an installer adds a new MCP server without user notice, this catches it.",
  whenToUse: "On every session start; after `mneme update`; when audit reports unexpected severity.",
  triggers: ["mcp drift", "skeleton key drift", "did mcp config change"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.skeletonKey.detectConfigDrift(cwd);
      return {
        data: r,
        wisdom: r.hint,
        followUp: r.ok ? [] : ["mneme.skeleton_key.audit"],
        confidence: { level: r.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "drift failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const skeletonKeyProbeTool: MnemeTool = {
  name: "mneme.skeleton_key.probe",
  category: "meta",
  description:
    "🦴 SKELETON KEY — empirically spawn ONE MCP server + read its tools/list. Returns the ground-truth capability set (not name-heuristic). Read-only: never calls tools/call. Use to upgrade a 'unknown' or low-severity heuristic finding to ground truth.",
  whenToUse: "Server name doesn't match any known heuristic; user wants to know exactly what an MCP server can do before trusting it.",
  triggers: ["probe mcp server", "skeleton key probe"],
  inputSchema: {
    type: "object",
    required: ["server"],
    properties: { server: { type: "string", description: "MCP server name to probe (must exist in a discovered config)." } },
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const name = String(args["server"] ?? "");
      const all = core.skeletonKey.discoverServers(core.skeletonKey.defaultConfigPaths());
      const found = all.find((s) => s.name === name);
      if (!found || !found.command) {
        return { data: { ok: false, hint: `server '${name}' not found in any discovered config` }, wisdom: "no such server", followUp: ["mneme.skeleton_key.audit"], confidence: { level: "medium" as const } };
      }
      const r = await core.skeletonKey.probeServer({ name: found.name, command: found.command, args: found.args, env: found.env });
      return {
        data: r,
        wisdom: r.reachable ? `${r.tools.length} tools · ${r.capabilities.length} capabilities (latency ${r.latencyMs}ms)` : `unreachable: ${r.reason}`,
        followUp: r.reachable ? ["mneme.skeleton_key.audit"] : [],
        confidence: { level: r.reachable ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "probe failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const SKELETON_KEY_TOOLS: MnemeTool[] = [
  skeletonKeyAuditTool,
  skeletonKeyRecommendTool,
  skeletonKeyPinTool,
  skeletonKeyDriftTool,
  skeletonKeyProbeTool,
];

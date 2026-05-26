/**
 * v2.61.0 — PASSPORT MCP tool surface.
 *
 *   mneme.capability.request   — request a passport for a sensitive tool
 *   mneme.capability.verify    — verify a passport token
 *   mneme.capability.revoke    — revoke a passport (with cascade)
 *   mneme.capability.audit     — show ledger + chain integrity
 *   mneme.capability.policy    — show default policy
 *
 * Wraps core/src/passport/. Agents call `request` before sensitive ops;
 * downstream tool servers verify via `verify`; revocation cascade flows
 * automatically through the delegation graph.
 */

import type { MnemeTool } from "./_types.js";

export const capabilityRequestTool: MnemeTool = {
  name: "mneme.capability.request",
  category: "meta",
  description:
    "🛂 PASSPORT — request a capability passport for a sensitive tool. Trust score (fused from NEMESIS env-scan + verify_identity + HONEST_MIRROR + STEALTH + history) must clear the tier's threshold. Returns HMAC-signed token + TTL on grant, structured refusal on deny. Use BEFORE calling any tool that mutates state, executes code, or hits the network.",
  whenToUse:
    "Agent is about to call a tool that could mutate user data / execute code / make outbound network calls. Get a passport first; if refused, escalate to user.",
  triggers: ["request passport", "capability request", "passport for"],
  inputSchema: {
    type: "object",
    required: ["tool", "agent"],
    properties: {
      tool: { type: "string", description: "Tool name (e.g. shell.exec, fs.write_file, http.fetch)." },
      agent: { type: "string", description: "Requesting agent identifier (vendor or session id)." },
      tier: { type: "string", description: "Optional explicit tier (safe/read/write/network/destructive). Otherwise auto-classified.", enum: ["safe", "read", "write", "network", "destructive"] },
      scope: { type: "array", items: { type: "string" }, description: "Optional scope sub-restrictions (subset of tool's full capability)." },
      parent: { type: "string", description: "Optional parent passport token (for delegation; child scope must be subset of parent)." },
      trustInputs: {
        type: "object",
        description: "Trust signals fed into the fusion. All optional; missing signals = neutral 0.5.",
        properties: {
          envScanConfidence: { type: "number" },
          identityVerdict: { type: "string", enum: ["CONFIRMED", "DISPUTED", "IMPOSSIBLE", "INCONCLUSIVE"] },
          honestMirrorWeight: { type: "number" },
          stealthScore: { type: "number" },
          historicalApprovalRate: { type: "number" },
          perCapabilityScore: { type: "number" },
        },
      },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.passport.issuePassport({
        tool: String(args["tool"]),
        agent: String(args["agent"]),
        tier: args["tier"] as import("@mneme-ai/core").passport.RiskTier | undefined,
        scope: Array.isArray(args["scope"]) ? args["scope"] as string[] : undefined,
        parent: typeof args["parent"] === "string" ? args["parent"] : undefined,
        trustInputs: args["trustInputs"] as import("@mneme-ai/core").passport.TrustInputs | undefined,
        cwd,
      });
      return {
        data: r,
        wisdom: r.ok ? `granted: ${r.hint}` : `refused: ${r.hint}`,
        followUp: r.ok ? ["mneme.capability.verify"] : ["mneme.skeleton_key.audit"],
        confidence: { level: r.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "request failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const capabilityVerifyTool: MnemeTool = {
  name: "mneme.capability.verify",
  category: "meta",
  description:
    "🛂 PASSPORT — verify a passport token. Checks HMAC + TTL + revocation + optional expected tool/scope. Returns ttlMs when valid. Downstream tool servers call this before executing the requested op.",
  whenToUse: "Tool server (or AI agent acting as one) wants to confirm a passport before executing the granted op.",
  triggers: ["verify passport", "capability verify"],
  inputSchema: {
    type: "object",
    required: ["token"],
    properties: {
      token: { type: "string" },
      expectedTool: { type: "string" },
      expectedScope: { type: "array", items: { type: "string" } },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.passport.verifyPassport({
        token: String(args["token"]),
        expectedTool: typeof args["expectedTool"] === "string" ? args["expectedTool"] : undefined,
        expectedScope: Array.isArray(args["expectedScope"]) ? args["expectedScope"] as string[] : undefined,
        cwd,
      });
      return {
        data: r,
        wisdom: r.valid ? `valid (ttl=${r.ttlMs}ms)` : `invalid: ${r.reason}`,
        followUp: [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const capabilityRevokeTool: MnemeTool = {
  name: "mneme.capability.revoke",
  category: "meta",
  description:
    "🛂 PASSPORT — revoke a passport. CASCADE mode (default) also revokes every delegated descendant in the delegation graph. Use after a vendor incident, suspected compromise, or end-of-session cleanup.",
  whenToUse: "Vendor incident; session ends; suspect compromised passport.",
  triggers: ["revoke passport", "capability revoke"],
  inputSchema: {
    type: "object",
    properties: {
      token: { type: "string" },
      jti: { type: "string" },
      cascade: { type: "boolean", description: "Default true. When true, revoke all delegated descendants." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.passport.revokePassport({
        token: typeof args["token"] === "string" ? args["token"] : undefined,
        jti: typeof args["jti"] === "string" ? args["jti"] : undefined,
        cascade: args["cascade"] !== false,
        cwd,
      });
      return {
        data: r,
        wisdom: r.hint,
        followUp: ["mneme.capability.audit"],
        confidence: { level: r.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "revoke failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const capabilityAuditTool: MnemeTool = {
  name: "mneme.capability.audit",
  category: "meta",
  description:
    "🛂 PASSPORT — verify the HMAC-chained passport ledger + return the last N entries. Tamper-evident audit trail of every issuance / verification / revocation. Court-admissible chain.",
  whenToUse: "Compliance audit; investigating an unauthorized op; verifying chain integrity after suspected tampering.",
  triggers: ["passport audit", "capability audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.passport.verifyLedgerChain(cwd);
      const rows = core.passport.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return {
        data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) },
        wisdom: led.ok ? `ledger intact (${led.rows} rows)` : `ledger BROKEN at row ${led.brokenAt}`,
        followUp: [],
        confidence: { level: led.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const capabilityPolicyTool: MnemeTool = {
  name: "mneme.capability.policy",
  category: "meta",
  description:
    "🛂 PASSPORT — show the current default policy (tier → minTrust + ttlMs + description). Use to understand what an agent must clear before sensitive ops.",
  whenToUse: "User asks 'what does the agent need for X'; pre-configure a new MCP install; document compliance posture.",
  triggers: ["passport policy", "capability policy"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    try {
      const core = await import("@mneme-ai/core");
      return {
        data: { policy: core.passport.DEFAULT_POLICY },
        wisdom: "default policy (override via .mneme/passport/policy.json — wire pending v2.62+)",
        followUp: [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "policy fetch failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const CAPABILITY_PASSPORT_TOOLS: MnemeTool[] = [
  capabilityRequestTool,
  capabilityVerifyTool,
  capabilityRevokeTool,
  capabilityAuditTool,
  capabilityPolicyTool,
];

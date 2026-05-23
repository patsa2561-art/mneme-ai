/**
 * v2.33.0 — MCP wrappers for COERCION audit (HMAC-signed audit envelope).
 *
 * Distinct from the older `mneme.coercion.*` 5-tier CLI module
 * (coercion_taxonomy/). This is the academic paper-prep primitive:
 * scan ANY MCP tool response or pulse text against 8 patterns →
 * HMAC-signed per-source audit + multi-source roll-up envelope.
 *
 * 3 tools:
 *   mneme.coercion_audit.text     — audit one text source
 *   mneme.coercion_audit.many     — audit N sources + roll up
 *   mneme.coercion_audit.verify   — offline HMAC verify
 */

import type { MnemeTool } from "./_types.js";

export const coercionAuditTextTool: MnemeTool = {
  name: "mneme.coercion_audit.text",
  category: "meta",
  description: "COERCION AUDIT — scan one text source against 8 Tool-to-Agent coercion patterns + emit HMAC-signed per-source report.",
  whenToUse: "Auditing a specific pulse / status / MCP response for coercion patterns.",
  triggers: ["coercion audit", "tool-to-agent coercion"],
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Label (file path / tool name / 'pulse')." },
      text: { type: "string" },
    },
    required: ["source", "text"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.coercion.auditText(String(args["source"] ?? "unknown"), String(args["text"] ?? ""));
    return {
      data: r,
      wisdom: r.headline,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const coercionAuditManyTool: MnemeTool = {
  name: "mneme.coercion_audit.many",
  category: "meta",
  description: "COERCION AUDIT — survey N text sources (e.g. 20 MCP servers) + emit a roll-up envelope (USENIX-paper-grade reference data).",
  whenToUse: "Cross-server taxonomy survey; publishing reproducible audit data.",
  triggers: ["coercion survey", "audit many"],
  inputSchema: {
    type: "object",
    properties: {
      sources: {
        type: "array",
        description: "Array of { source, text } pairs.",
        items: { type: "object", properties: { source: { type: "string" }, text: { type: "string" } } },
      },
    },
    required: ["sources"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const sources = Array.isArray(args["sources"]) ? (args["sources"] as Array<{ source: string; text: string }>) : [];
    const r = core.coercion.auditMany(sources);
    return {
      data: r,
      wisdom: `Survey: ${r.sources.length} source(s) · overall ${r.overallBand} (score ${r.overallScore}).`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const coercionAuditVerifyTool: MnemeTool = {
  name: "mneme.coercion_audit.verify",
  category: "meta",
  description: "COERCION AUDIT — offline HMAC verify of a pasted per-source or multi-source audit envelope.",
  whenToUse: "Cross-machine attestation.",
  triggers: ["coercion audit verify"],
  inputSchema: {
    type: "object",
    properties: { audit: { type: "object" } },
    required: ["audit"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const audit = args["audit"] as Parameters<typeof core.coercion.verifyAudit>[0];
    if (!audit || typeof audit !== "object") {
      return {
        data: { ok: false, reason: "audit missing" },
        wisdom: "Pass `audit`.",
        followUp: [], confidence: { level: "high" as const },
      };
    }
    const r = core.coercion.verifyAudit(audit);
    return {
      data: r,
      wisdom: r.ok ? "Audit HMAC verified." : `HMAC FAIL: ${r.reason}`,
      followUp: [], confidence: { level: "high" as const },
    };
  },
};

export const COERCION_AUDIT_TOOLS: MnemeTool[] = [
  coercionAuditTextTool,
  coercionAuditManyTool,
  coercionAuditVerifyTool,
];

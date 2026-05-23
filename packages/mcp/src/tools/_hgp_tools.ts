/**
 * v2.31.0 — MCP wrappers for HGP (Hallucination Genome Project).
 *
 * 6 tools:
 *   mneme.hgp.record         — record a hallucination observation (vendor-attributed)
 *   mneme.hgp.lookup         — get a record by HGP-ID
 *   mneme.hgp.top            — top-N most-severe hallucinations
 *   mneme.hgp.severity       — per-vendor severity in a time window
 *   mneme.hgp.federate_status — opt-in status + local count
 *   mneme.hgp.federate_join  — toggle opt-in / set endpoint
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const hgpRecordTool: MnemeTool = {
  name: "mneme.hgp.record",
  category: "meta",
  description:
    "HGP — record a hallucination observation (claim + signature + vendor). Returns the deterministic CVE-style " +
    "HGP-ID (HGP-YYYY-NNNNN). Same hallucination shape from different users hashes to the SAME HGP-ID, building " +
    "a cross-user catalog of vendor-attributed lies. Auto-wired into ACGV vaccine emission — manual calls only " +
    "needed for adapters outside the ACGV pipeline.",
  whenToUse: "Manually attributing an external hallucination; testing the registry; non-ACGV detection adapters.",
  triggers: ["hgp record", "record hallucination"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The hallucinated claim text." },
      signature: { type: "string", description: "Which proof layer flagged it (chandrasekhar/godel/hyperbole/vaccine)." },
      vendor: { type: "string", description: "Vendor that produced the hallucination." },
    },
    required: ["claim", "signature"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.hgp.lookup", "mneme.hgp.top"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const r = core.hgp.recordHallucination(repoRoot, {
      claim: String(args["claim"] ?? ""),
      signature: String(args["signature"] ?? "unknown"),
      ...(typeof args["vendor"] === "string" ? { vendor: args["vendor"] as string } : {}),
    });
    return {
      data: {
        hgpId: r.hgpId,
        simhash: r.simhash,
        observeCount: r.observeCount,
        vendorCounts: r.vendorCounts,
        severity: r.severity,
      },
      wisdom: `HGP-ID ${r.hgpId} · observeCount=${r.observeCount} · severity=${r.severity}`,
      followUp: ["mneme.hgp.lookup", "mneme.hgp.top"],
      confidence: { level: "high" as const },
    };
  },
};

export const hgpLookupTool: MnemeTool = {
  name: "mneme.hgp.lookup",
  category: "meta",
  description: "HGP — fetch a record by HGP-ID (CVE-style HGP-YYYY-NNNNN[-suffix]).",
  whenToUse: "User typed an HGP-ID and wants the underlying record.",
  triggers: ["hgp lookup", "lookup hallucination"],
  inputSchema: {
    type: "object",
    properties: { hgpId: { type: "string" } },
    required: ["hgpId"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const id = String(args["hgpId"] ?? "");
    if (!core.hgp.isValidHgpId(id)) {
      return {
        data: { ok: false, reason: "malformed HGP-ID — expected HGP-YYYY-NNNNN" },
        wisdom: "HGP-IDs look like HGP-2026-00001.",
        followUp: [],
        confidence: { level: "high" as const },
      };
    }
    const r = core.hgp.lookup(repoRoot, id);
    return {
      data: r ? { found: true, record: r } : { found: false, hgpId: id },
      wisdom: r ? `${r.hgpId}: severity ${r.severity} · ${r.observeCount} observations` : `HGP-ID ${id} not in local registry.`,
      followUp: r ? [] : ["mneme.hgp.top"],
      confidence: { level: "high" as const },
    };
  },
};

export const hgpTopTool: MnemeTool = {
  name: "mneme.hgp.top",
  category: "meta",
  description: "HGP — return the top-N most-severe hallucinations (sorted by severity then observeCount).",
  whenToUse: "Dashboard / public roll-up; quarterly hallucination audit.",
  triggers: ["hgp top", "top hallucinations"],
  inputSchema: { type: "object", properties: { n: { type: "integer" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const n = typeof args["n"] === "number" ? (args["n"] as number) : 10;
    const top = core.hgp.topN(repoRoot, n);
    return {
      data: {
        count: top.length,
        records: top.map((r) => ({
          hgpId: r.hgpId,
          severity: r.severity,
          observeCount: r.observeCount,
          vendorCounts: r.vendorCounts,
          sample: r.sample,
          lastSeen: r.lastSeen,
        })),
      },
      wisdom: top.length === 0 ? "No hallucinations recorded yet." : `Top ${top.length} — most-severe HGP-ID: ${top[0]!.hgpId} (severity ${top[0]!.severity})`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const hgpSeverityTool: MnemeTool = {
  name: "mneme.hgp.severity",
  category: "meta",
  description: "HGP — per-vendor severity over a time window (default 30 days). Mirrors the `mneme hgp severity --vendor X --window 30d` CLI.",
  whenToUse: "Audit a specific vendor's recent hallucination footprint; vendor selection.",
  triggers: ["hgp severity", "vendor severity", "vendor halluc"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      windowDays: { type: "integer", description: "Default 30." },
      allVendors: { type: "boolean", description: "When true, return breakdown across all observed vendors." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const windowDays = typeof args["windowDays"] === "number" ? (args["windowDays"] as number) : 30;
    if (args["allVendors"] === true) {
      const all = core.hgp.allVendorsBreakdown(repoRoot, windowDays);
      return {
        data: { windowDays, count: all.length, vendors: all },
        wisdom: all.length === 0 ? "No vendor-attributed observations in window." : `${all.length} vendor(s) observed in last ${windowDays}d.`,
        followUp: [],
        confidence: { level: "high" as const },
      };
    }
    const vendor = String(args["vendor"] ?? "");
    if (!vendor) {
      return {
        data: { ok: false, reason: "vendor required (or pass allVendors:true)" },
        wisdom: "Pass vendor='anthropic' or allVendors:true.",
        followUp: [],
        confidence: { level: "high" as const },
      };
    }
    const sw = core.hgp.severityForVendor(repoRoot, vendor, windowDays);
    return {
      data: sw,
      wisdom: `${vendor} — ${sw.count} observations in last ${windowDays}d · mean severity ${sw.meanSeverity}`,
      followUp: ["mneme.hgp.top"],
      confidence: { level: "high" as const },
    };
  },
};

export const hgpFederateStatusTool: MnemeTool = {
  name: "mneme.hgp.federate_status",
  category: "meta",
  description: "HGP — read federation status (opt-in flag + endpoint + local count). Federation default is OFF.",
  whenToUse: "Before opting in; consent audit.",
  triggers: ["hgp federate status", "hgp consent"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const s = core.hgp.federationStatus(repoRoot);
    return {
      data: s,
      wisdom: s.consent.optIn ? `Federation OPT-IN (endpoint=${s.consent.endpoint ?? "<none>"}) · local count ${s.localCount}` : `Federation OFF (private-by-default). Local count ${s.localCount}.`,
      followUp: s.consent.optIn ? [] : ["mneme.hgp.federate_join"],
      confidence: { level: "high" as const },
    };
  },
};

export const hgpFederateJoinTool: MnemeTool = {
  name: "mneme.hgp.federate_join",
  category: "meta",
  description: "HGP — opt in / out of federation. Pass optIn=true + endpoint to enable; optIn=false to revoke.",
  whenToUse: "User explicitly opts in to push their HGP entries to the public registry.",
  triggers: ["hgp federate join", "hgp opt in"],
  inputSchema: {
    type: "object",
    properties: {
      optIn: { type: "boolean" },
      endpoint: { type: "string", description: "https://hgp.ai (placeholder until v2.32.x protocol envelope ships)." },
    },
    required: ["optIn"],
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const optIn = args["optIn"] === true;
    const endpoint = typeof args["endpoint"] === "string" ? (args["endpoint"] as string) : undefined;
    const c = core.hgp.setConsent(repoRoot, optIn, endpoint);
    return {
      data: { consent: c },
      wisdom: optIn ? `Federation OPT-IN saved. Endpoint=${endpoint ?? "<none>"}` : "Federation OPT-OUT saved.",
      followUp: ["mneme.hgp.federate_status"],
      confidence: { level: "high" as const },
    };
  },
};

export const HGP_TOOLS: MnemeTool[] = [
  hgpRecordTool,
  hgpLookupTool,
  hgpTopTool,
  hgpSeverityTool,
  hgpFederateStatusTool,
  hgpFederateJoinTool,
];

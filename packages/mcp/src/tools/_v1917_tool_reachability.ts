/**
 * v2.19.17 TOOL REACHABILITY ENGINE — 4 MCP tools (the ghost-tool killer).
 *
 *   mneme.reachability.scan          — full per-tool reachability report
 *   mneme.reachability.report        — global summary (mean / ghost count)
 *   mneme.reachability.ghost_list    — just the ghost tools (publish blockers)
 *   mneme.reachability.surface_audit — per-surface coverage stats
 *
 * Ritual integration: phase3.no-ghost-tools-v218 reads scan output via
 * the HMAC-signed report; any v2.18+ tool with score=0 BLOCKS publish.
 */

import type { MnemeTool } from "./_types.js";

/** Default v2.18+ enforced families — keeps gate scoped to recent shipments. */
const ENFORCED_FAMILIES = [
  "arena", "badge", "oracle", "nexus", "confessional", "ghost", "trinity", "insurance", "boomerang",
  "evolution", "soul", "mcp_drift", "embedder", "inverse", "intent", "dna", "chronostasis",
  "agreement", "dream", "colony", "honey", "retroactive", "genetic", "jackpot", "genome",
  "proof", "suggest", "mortal", "muscle", "dialect", "brain", "chrysalis", "snn", "negev",
  "dreams", "chimera", "consequence", "truth", "federated", "reachability",
];

async function gatherSurfaces(): Promise<import("@mneme-ai/core").toolReachability.SurfaceSource[]> {
  const core = await import("@mneme-ai/core");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  // Locate repo root from current file (works in dev + installed npm tarball).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../.."),
    resolve(here, "../../..", "node_modules"),
    process.cwd(),
  ];
  // The surface files we know about (best-effort; missing files just skip).
  const sources: Array<[import("@mneme-ai/core").toolReachability.SurfaceKind, string[]]> = [
    ["cli_router", ["packages/cli/src/commands/universal_mcp_subcommands.ts", "packages/cli/dist/commands/universal_mcp_subcommands.js"]],
    ["welcome_syllabus", ["packages/core/src/agent_manifest.ts", "packages/core/dist/agent_manifest.js"]],
    ["whats_new", ["packages/core/src/whats_new.ts", "packages/core/dist/whats_new.js"]],
    ["suggested_next", ["packages/core/src/reverse_wrapper/index.ts", "packages/core/dist/reverse_wrapper/index.js"]],
    ["capabilities", ["packages/mcp/src/tools/_capabilities.ts", "packages/mcp/dist/tools/_capabilities.js"]],
  ];
  const out: import("@mneme-ai/core").toolReachability.SurfaceSource[] = [];
  for (const [kind, relPaths] of sources) {
    for (const base of candidates) {
      let found = false;
      for (const rel of relPaths) {
        const abs = resolve(base, rel);
        const surf = core.toolReachability.loadSurface(kind, abs);
        if (surf) {
          out.push(surf);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  return out;
}

async function buildCatalog(): Promise<string[]> {
  const { buildAllTools } = await import("./_registry.js");
  return buildAllTools().map((t) => t.name);
}

export const reachabilityScanTool: MnemeTool = {
  name: "mneme.reachability.scan",
  category: "audit",
  description:
    "🎯 REACHABILITY — full per-tool report: which user-facing surfaces (CLI router, welcome syllabus, whats_new, suggested-next rules, capabilities) reach each MCP tool. Score=0 = GHOST (publish blocker for v2.18+ tools).",
  whenToUse: "Before any release — confirm no v2.18+ tool ships invisible to users.",
  triggers: ["reachability scan", "ghost tool scan"],
  inputSchema: {
    type: "object",
    properties: {
      enforceFamilies: { type: "array", items: { type: "string" }, description: "If supplied, only score tools whose family appears here. Defaults to v2.18+ families." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scan reachability for v2.18+ tools", expectedOutput: "{ totalTools, ghostCount, meanScore, perTool, ghostList }" }],
  pitfalls: ["Reads source files from the install path; if files missing the scanner just skips that surface."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildCatalog();
    const surfaces = await gatherSurfaces();
    const r = core.toolReachability.scanReachability({
      catalog,
      surfaces,
      enforceFamilies: (args["enforceFamilies"] as string[] | undefined) ?? ENFORCED_FAMILIES,
    });
    return { data: r, wisdom: core.toolReachability.ghostListSummary(r), confidence: { level: "high" } };
  },
};

export const reachabilityReportTool: MnemeTool = {
  name: "mneme.reachability.report",
  category: "audit",
  description:
    "🎯 REACHABILITY — global summary: total tools scanned, ghost count, mean score, per-surface coverage. Fast triage.",
  whenToUse: "Daily / pre-release health check.",
  triggers: ["reachability report"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Reachability summary", expectedOutput: "{ totalTools, ghostCount, meanScore, scannedAt }" }],
  pitfalls: ["A high mean score doesn't guarantee no ghosts — always check ghostCount=0 specifically."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildCatalog();
    const surfaces = await gatherSurfaces();
    const r = core.toolReachability.scanReachability({
      catalog,
      surfaces,
      enforceFamilies: ENFORCED_FAMILIES,
    });
    return {
      data: { totalTools: r.totalTools, ghostCount: r.ghostCount, meanScore: r.meanScore, scannedAt: r.scannedAt },
      wisdom: core.toolReachability.ghostListSummary(r),
      confidence: { level: "high" },
    };
  },
};

export const reachabilityGhostListTool: MnemeTool = {
  name: "mneme.reachability.ghost_list",
  category: "audit",
  description:
    "🎯 REACHABILITY — list tools with reachability score=0. These are the v2.18+ publish blockers — must be wired before next release.",
  whenToUse: "Before release; after orphan-scan passes (orphan check proves wrapper EXISTS; reachability check proves wrapper is REACHABLE).",
  triggers: ["ghost list", "ghost tools"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show ghost tools", expectedOutput: "{ ghostCount, ghostList }" }],
  pitfalls: ["Empty ghostList = no blockers. Any entry = wire that tool into ≥1 user-facing surface."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildCatalog();
    const surfaces = await gatherSurfaces();
    const r = core.toolReachability.scanReachability({
      catalog,
      surfaces,
      enforceFamilies: ENFORCED_FAMILIES,
    });
    return { data: { ghostCount: r.ghostCount, ghostList: r.ghostList }, wisdom: core.toolReachability.ghostListSummary(r), confidence: { level: "high" } };
  },
};

export const reachabilitySurfaceAuditTool: MnemeTool = {
  name: "mneme.reachability.surface_audit",
  category: "audit",
  description:
    "🎯 REACHABILITY — per-surface coverage: how many tools each surface (cli_router / welcome / whats_new / suggested_next / capabilities) actually reaches. Identifies under-utilised surfaces.",
  whenToUse: "Auditing whether a particular user-facing surface is healthy.",
  triggers: ["surface audit", "reachability surfaces"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which surfaces are doing the work?", expectedOutput: "{ perSurface: { cli_router: N, welcome_syllabus: N, ... } }" }],
  pitfalls: ["A surface with low coverage isn't necessarily broken — capabilities is intentionally a curated subset."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await buildCatalog();
    const surfaces = await gatherSurfaces();
    const r = core.toolReachability.scanReachability({
      catalog,
      surfaces,
      enforceFamilies: ENFORCED_FAMILIES,
    });
    const perSurface: Record<string, number> = { cli_router: 0, welcome_syllabus: 0, whats_new: 0, suggested_next: 0, capabilities: 0 };
    for (const t of r.perTool) {
      for (const h of t.hits) perSurface[h.surface] = (perSurface[h.surface] ?? 0) + 1;
    }
    return { data: { totalTools: r.totalTools, perSurface, surfacesAvailable: surfaces.length }, wisdom: `🎯 surfaces: ${Object.entries(perSurface).map(([k, v]) => `${k}=${v}`).join(", ")}`, confidence: { level: "high" } };
  },
};

export const V1917_TOOL_REACHABILITY_TOOLS: MnemeTool[] = [
  reachabilityScanTool, reachabilityReportTool, reachabilityGhostListTool, reachabilitySurfaceAuditTool,
];

/**
 * v2.19.21 GAP CLOSER — 4 MCP tools (W5 + W6 + W7 fixes from the v2.19.20 audit).
 *
 *   🆙 SNN AUTO-PROMOTE (2 tools):
 *     mneme.snn.promote_decide   — should the saved config be auto-promoted to runtime tier?
 *     mneme.snn.promote_tier     — parse an embedder name into its tier label
 *
 *   🪞 CLI FAMILY-CLASH AUDIT (2 tools):
 *     mneme.cli.clash_audit      — which MCP families clash with legacy CLI commands?
 *     mneme.cli.mounted_families — which MCP families auto-mounted onto legacy parents (v2.19.21)?
 *
 * The router enhancement in v2.19.21 makes 4 previously-unreachable SYNCRETIC
 * families (ghost / trinity / insurance / boomerang) reachable as
 * `mneme <family> <action>` subcommands of the legacy parent. The audit
 * tools surface the resolved state so users can verify.
 */

import type { MnemeTool } from "./_types.js";

const KNOWN_LEGACY_TOP_LEVEL = [
  // Legacy top-level commands that previously blocked MCP family auto-routing.
  // After v2.19.21, MCP subcommands are MOUNTED onto these parents instead of skipped.
  "ghost", "dream", "oracle", "constitution",
  "wisdom", "audit", "anomaly", "forensics", "insights",
];

const V218_PLUS_FAMILIES = [
  "arena", "badge", "oracle", "nexus",
  "confessional", "ghost", "trinity", "insurance", "boomerang",
  "evolution", "soul", "mcp_drift", "embedder",
  "inverse", "intent", "dna", "chronostasis", "agreement",
  "dream", "colony", "honey", "retroactive", "genetic",
  "jackpot", "genome", "proof", "suggest",
  "mortal", "muscle", "dialect", "brain", "chrysalis",
  "snn", "negev", "dreams", "chimera", "consequence",
  "truth", "federated", "reachability",
  "caption", "inpaint", "rci", "provenance", "textron",
];

// ─── SNN auto-promote tools ─────────────────────────────────────────────

export const snnPromoteDecideTool: MnemeTool = {
  name: "mneme.snn.promote_decide",
  category: "audit",
  description:
    "🆙 SNN-PROMOTE — should mneme status auto-write a higher-tier provider to .mneme/config.json? Refuses to downgrade (user pin always wins). Composes onto v2.19.16 BundledOrSnnEmbedder fallback.",
  whenToUse: "Daemon-side health check before persisting an embedder tier change.",
  triggers: ["snn promote", "embedder auto promote"],
  inputSchema: {
    type: "object",
    properties: {
      savedProvider: { type: "string", description: "openai/ollama/snn/bundled/hash/auto/unknown" },
      runtimeResolvedName: { type: "string", description: "name field from resolveEmbedder() output, e.g. 'snn:lif-32x64'" },
    },
    required: ["savedProvider", "runtimeResolvedName"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should I promote from hash to snn?", args: { savedProvider: "hash", runtimeResolvedName: "snn:lif-32x64" }, expectedOutput: "{ shouldPromote: true, recommendedProvider: 'snn', reason }" }],
  pitfalls: ["Only writes when saved tier is 'hash' or 'auto'. Refuses to overwrite explicit user pins."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.snnAutoPromote.decidePromotion({
      savedProvider: args["savedProvider"] as Parameters<typeof core.snnAutoPromote.decidePromotion>[0]["savedProvider"],
      runtimeResolvedName: String(args["runtimeResolvedName"]),
    });
    return { data: d, wisdom: core.snnAutoPromote.formatDecisionLine(d), confidence: { level: "high" } };
  },
};

export const snnPromoteTierTool: MnemeTool = {
  name: "mneme.snn.promote_tier",
  category: "audit",
  description: "🆙 SNN-PROMOTE — parse an embedder name (e.g. 'snn:lif-32x64') into its tier label. Used by audit + status surfaces.",
  whenToUse: "When you have an embedder name string and need the canonical tier.",
  triggers: ["embedder tier", "snn tier"],
  inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What tier is snn:lif-32x64?", args: { name: "snn:lif-32x64" }, expectedOutput: "{ tier: 'snn' }" }],
  pitfalls: ["Unknown prefixes return 'unknown', not throw."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const tier = core.snnAutoPromote.tierFromName(String(args["name"]));
    return { data: { tier }, wisdom: `🆙 tier=${tier}`, confidence: { level: "high" } };
  },
};

// ─── CLI clash audit tools ──────────────────────────────────────────────

export const cliClashAuditTool: MnemeTool = {
  name: "mneme.cli.clash_audit",
  category: "audit",
  description:
    "🪞 CLI-CLASH AUDIT — list MCP families that clash with legacy top-level CLI commands. v2.19.21 router now MOUNTS MCP subcommands onto the legacy parent (so `mneme ghost distill` works even though `mneme ghost` is the legacy ghost-code lens).",
  whenToUse: "Verify no v2.18+ family is hidden behind a legacy name collision.",
  triggers: ["cli clash", "family clash audit"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which families clash with legacy CLI commands?", expectedOutput: "{ clashingFamilies, totalMcpFamilies, totalLegacyCommands }" }],
  pitfalls: ["This is a STATIC audit (known legacy command list). Runtime registration verifier is mneme.cli.mounted_families."],
  handler: async (_rt, _args) => {
    const { buildAllTools } = await import("./_registry.js");
    const families = new Set<string>();
    for (const t of buildAllTools()) {
      const parts = t.name.split(".");
      if (parts.length === 3 && parts[0] === "mneme") families.add(parts[1]!);
    }
    const clashing = Array.from(families).filter((f) => KNOWN_LEGACY_TOP_LEVEL.includes(f)).sort();
    return {
      data: {
        clashingFamilies: clashing,
        totalMcpFamilies: families.size,
        totalLegacyCommands: KNOWN_LEGACY_TOP_LEVEL.length,
        resolution: "v2.19.21 router mounts MCP subcommands onto the existing legacy parent (no `continue` skip).",
      },
      wisdom: clashing.length === 0 ? "🪞 no clashes" : `🪞 ${clashing.length} clashes (${clashing.join(",")}) — now mounted onto legacy parents`,
      confidence: { level: "high" },
    };
  },
};

export const cliMountedFamiliesTool: MnemeTool = {
  name: "mneme.cli.mounted_families",
  category: "audit",
  description: "🪞 CLI-CLASH AUDIT — list v2.18+ MCP families that EXIST + the legacy commands their subcommands were mounted onto. Companion to mneme.reachability.scan: this proves CLI surface reachability for clashing families.",
  whenToUse: "After install, verify every v2.18+ family is reachable from the CLI either as a fresh top-level or mounted on a legacy parent.",
  triggers: ["mounted families", "cli surface audit"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which v2.18+ families are CLI-reachable?", expectedOutput: "{ standalone: [...], mountedOnLegacy: { ghost: ['distill','ask'], ... } }" }],
  pitfalls: ["This is a STATIC analysis. To verify runtime registration, run `mneme <family> --help` after install."],
  handler: async (_rt, _args) => {
    const { buildAllTools } = await import("./_registry.js");
    const familyActions = new Map<string, string[]>();
    for (const t of buildAllTools()) {
      const parts = t.name.split(".");
      if (parts.length !== 3 || parts[0] !== "mneme") continue;
      const arr = familyActions.get(parts[1]!) ?? [];
      arr.push(parts[2]!);
      familyActions.set(parts[1]!, arr);
    }
    const standalone: Record<string, string[]> = {};
    const mountedOnLegacy: Record<string, string[]> = {};
    for (const family of V218_PLUS_FAMILIES) {
      const actions = familyActions.get(family);
      if (!actions) continue;
      if (KNOWN_LEGACY_TOP_LEVEL.includes(family)) {
        mountedOnLegacy[family] = actions;
      } else {
        standalone[family] = actions;
      }
    }
    return {
      data: {
        standalone,
        mountedOnLegacy,
        standaloneCount: Object.keys(standalone).length,
        mountedCount: Object.keys(mountedOnLegacy).length,
        v218PlusFamiliesAuditedTotal: V218_PLUS_FAMILIES.length,
      },
      wisdom: `🪞 standalone=${Object.keys(standalone).length} · mounted=${Object.keys(mountedOnLegacy).length}`,
      confidence: { level: "high" },
    };
  },
};

export const V1921_GAP_CLOSER_TOOLS: MnemeTool[] = [
  snnPromoteDecideTool, snnPromoteTierTool,
  cliClashAuditTool, cliMountedFamiliesTool,
];

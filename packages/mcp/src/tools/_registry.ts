/**
 * Tool registry — collects all category modules into one ordered list +
 * a fast lookup map. Each category file exports a `tools: MnemeTool[]`
 * array; the registry concatenates them and surfaces them to the MCP
 * server as one flat catalog (with namespaced names like
 * `mneme.people.atrophy` for AI client navigation).
 */

import type { MnemeTool, ToolCategory } from "./_types.js";

import { memoryTools } from "./memory.js";
import { peopleTools } from "./people.js";
import { auditTools } from "./audit.js";
import { forensicsTools } from "./forensics.js";
import { insightsTools } from "./insights.js";
import { qualityTools } from "./quality.js";
import { quantTools } from "./quant.js";
import { labTools } from "./lab.js";
import { metaTools } from "./meta.js";
import { capabilitiesTool } from "./_capabilities.js";
import { smartDoTool } from "./_smart_do.js";
import { graderTool } from "./_grader_tool.js";
import { understandIntentTool } from "./_intent_tool.js";
import { constitutionTool } from "./_constitution_tool.js";
import { verifyClaimsTool } from "./_verify_claims_tool.js";
import { truthCheckTool } from "./_truth_check.js";
import { TIER_TOOLS } from "./_tier_tools.js";
import { PATH_TOOLS } from "./_path_tools.js";
import { COGNITIVE_TOOLS } from "./_cognitive_tools.js";
import { APOPTOSIS_TOOLS } from "./_apoptosis_tools.js";
import { TUNE_TOOLS } from "./_tune_tools.js";
import { AUTARCHY_TOOLS } from "./_autarchy_tools.js";
import { AEGIS_TOOLS } from "./_aegis_tools.js";
import { ASCENSION_TOOLS } from "./_ascension_tools.js";
import { HYPERSCAN_TOOLS } from "./_hyperscan_tools.js";
import { PRECOG_TOOLS } from "./_precog_tools.js";
import { SENTINEL_TOOLS } from "./_sentinel_tools.js";
import { DIASPORA_TOOLS } from "./_diaspora_tools.js";
import { GENESPLICE_TOOLS } from "./_genesplice_tools.js";
import { dnaSearchTool } from "./_dna_tool.js";
import { genomeTools } from "./_genome_tools.js";
import { toolMetaTools } from "./_tool_meta.js";
import { adversaryTool } from "./_court.js";
import { confessTool } from "./_confess.js";
import { replayTools } from "./_replay.js";
import { timeTravelTools } from "./_timetravel.js";
import { genomeMarketplaceTools } from "./_genome_marketplace.js";
import { aletheiaTools, honeypotTools } from "./_aletheia.js";
import { meshTools } from "./_mesh.js";
import { lineageTools } from "./_lineage.js";
import { systemUpgradeTool, systemHealthTool } from "./_upgrade.js";
import { botSpawnTool } from "./_squadron.js";
import { nucleusTools } from "./_nucleus.js";
import { inboxTools } from "./_inbox.js";
import { antivirusTools } from "./_antivirus.js";
import { whatsNewTool } from "./_whats_new.js";
import { retrievalLabTools } from "./_retrieval_lab.js";

/** All Mneme tools, in display order. The capabilities syllabus comes first
 *  so AI clients that read tool lists top-down see it immediately. */
export function buildAllTools(): MnemeTool[] {
  return [
    capabilitiesTool,
    understandIntentTool,
    graderTool,
    verifyClaimsTool,
    truthCheckTool,
    ...TIER_TOOLS,
    ...PATH_TOOLS,
    ...COGNITIVE_TOOLS,
    ...APOPTOSIS_TOOLS,
    ...TUNE_TOOLS,
    ...AUTARCHY_TOOLS,
    ...AEGIS_TOOLS,
    ...ASCENSION_TOOLS,
    ...HYPERSCAN_TOOLS,
    ...PRECOG_TOOLS,
    ...SENTINEL_TOOLS,
    ...DIASPORA_TOOLS,
    ...GENESPLICE_TOOLS,
    constitutionTool,
    dnaSearchTool,
    ...genomeTools,
    ...toolMetaTools,
    adversaryTool,
    confessTool,
    ...replayTools,
    ...timeTravelTools,
    ...genomeMarketplaceTools,
    ...aletheiaTools,
    ...honeypotTools,
    ...meshTools,
    ...lineageTools,
    systemUpgradeTool,
    systemHealthTool,
    botSpawnTool,
    ...nucleusTools,
    ...inboxTools,
    ...antivirusTools,
    whatsNewTool,
    ...retrievalLabTools,
    smartDoTool,
    ...memoryTools,
    ...peopleTools,
    ...auditTools,
    ...forensicsTools,
    ...insightsTools,
    ...qualityTools,
    ...quantTools,
    ...labTools,
    ...metaTools,
  ];
}

/** Build a fast lookup table keyed by tool name */
export function buildToolMap(): Map<string, MnemeTool> {
  const out = new Map<string, MnemeTool>();
  for (const t of buildAllTools()) {
    if (out.has(t.name)) {
      throw new Error(`MCP tool name collision: ${t.name}`);
    }
    out.set(t.name, t);
  }
  return out;
}

/** Group tools by category — used by the capabilities syllabus tool */
export function groupByCategory(): Map<ToolCategory, MnemeTool[]> {
  const out = new Map<ToolCategory, MnemeTool[]>();
  for (const t of buildAllTools()) {
    if (!out.has(t.category)) out.set(t.category, []);
    out.get(t.category)!.push(t);
  }
  return out;
}

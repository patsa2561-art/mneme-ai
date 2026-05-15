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
import { PERMEATE_TOOLS } from "./_permeate_tools.js";
import { TELEPATHY_TOOLS } from "./_telepathy_tools.js";
import { ABYSS_TOOLS } from "./_abyss_tools.js";
import { SEAMLESS_TOOLS } from "./_seamless_tools.js";
import { LATTICE_TOOLS } from "./_lattice_tools.js";
import { NEURON_TOOLS } from "./_neuron_tools.js";
import { CONDUIT_TOOLS } from "./_conduit_tools.js";
import { SYNAPSE_TOOLS } from "./_synapse_tools.js";
import { OSMOSIS_TOOLS } from "./_osmosis_tools.js";
import { AURA_TOOLS } from "./_aura_tools.js";
import { RELAY_TOOLS } from "./_relay_tools.js";
import { CHAMELEON_TOOLS } from "./_chameleon_tools.js";
import { ANCHOR_TOOLS } from "./_anchor_tools.js";
import { RAINBOW_TOOLS } from "./_rainbow_tools.js";
import { ORPHANS_TOOLS } from "./_orphans_tools.js";
import { TRUTH_WORMHOLE_TOOLS } from "./_truth_wormhole_tools.js";
import { METRON_TOOLS } from "./_metron_tools.js";
import { V28_TOOLS } from "./_v28_tools.js";
import { CLONE_TO_TOOLS } from "./_clone_to_tool.js";
import { BEACON_TOOLS } from "./_beacon_tool.js";
import { NEXUS_LOCK_TOOLS } from "./_nexus_lock_tools.js";
import { COSMIC_TOOLS } from "./_cosmic_tools.js";
import { V214_PENTAD_TOOLS } from "./_v214_pentad.js";
import { V215_HYPERCAR_TOOLS } from "./_v215_hypercar.js";
import { V216_REVOLUTIONARY_TOOLS } from "./_v216_revolutionary.js";
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
    ...PERMEATE_TOOLS,
    ...TELEPATHY_TOOLS,
    ...ABYSS_TOOLS,
    ...SEAMLESS_TOOLS,
    ...LATTICE_TOOLS,
    ...NEURON_TOOLS,
    ...CONDUIT_TOOLS,
    ...SYNAPSE_TOOLS,
    ...OSMOSIS_TOOLS,
    ...AURA_TOOLS,
    ...RELAY_TOOLS,
    ...CHAMELEON_TOOLS,
    ...ANCHOR_TOOLS,
    ...RAINBOW_TOOLS,
    ...ORPHANS_TOOLS,
    ...TRUTH_WORMHOLE_TOOLS,
    ...METRON_TOOLS,
    ...V28_TOOLS,
    ...CLONE_TO_TOOLS,
    ...BEACON_TOOLS,
    ...NEXUS_LOCK_TOOLS,
    ...COSMIC_TOOLS,
    ...V214_PENTAD_TOOLS,
    ...V215_HYPERCAR_TOOLS,
    ...V216_REVOLUTIONARY_TOOLS,
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
